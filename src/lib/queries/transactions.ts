import { supabase } from "@/lib/supabase/client";
import { getCurrentUserId } from "@/lib/supabase/auth";

export interface Transaction {
  id: string;
  date: string;
  description: string | null;
  notes: string | null;
  amount: number;
  category_id: string | null;
  account_id: string | null;
  status: string | null;
  is_split: boolean | null;
  parent_id: string | null;
  source: string | null;
  upload_source: string | null;
  created_at: string | null;
  plaid_transaction_id: string | null;
  not_duplicate: boolean;
  allocations: SplitAllocation[];
  budget_categories?: {
    group_name: string;
    line_item_name: string;
    category_type: string;
  } | null;
  accounts?: {
    name: string;
    institution: string;
  } | null;
}

export interface SplitAllocation {
  id: string;
  amount: number;
  category_id: string;
  description: string | null;
  budget_categories?: {
    group_name: string;
    line_item_name: string;
    category_type: string;
  } | null;
}

export interface TransactionFilters {
  search?: string;
  categoryType?: "Income" | "Expense";
  categoryGroup?: string;
  categoryId?: string;
  accountId?: string;
  status?: string;
  uncategorizedOnly?: boolean;
  dateFrom?: string;
  dateTo?: string;
}

export type TransactionSortField =
  | "date"
  | "description"
  | "amount"
  | "group"
  | "lineItem"
  | "account"
  | "status";

export interface TransactionSort {
  field: TransactionSortField;
  direction: "asc" | "desc";
}

export async function getTransactions(
  page: number = 0,
  pageSize: number = 50,
  filters: TransactionFilters = {},
  sort: TransactionSort = { field: "date", direction: "desc" }
): Promise<{ data: Transaction[]; count: number }> {
  const userId = await getCurrentUserId();
  let categoryIds: string[] | null = null;

  if (filters.categoryId) {
    categoryIds = [filters.categoryId];
  } else if (filters.categoryGroup || filters.categoryType) {
    let categoryQuery = supabase
      .from("budget_categories")
      .select("id")
      .eq("user_id", userId);

    if (filters.categoryGroup) {
      categoryQuery = categoryQuery.eq("group_name", filters.categoryGroup);
    }
    if (filters.categoryType) {
      categoryQuery = categoryQuery.ilike("category_type", filters.categoryType);
    }

    const { data: categories, error: categoryError } = await categoryQuery;

    if (categoryError) throw categoryError;
    categoryIds = categories?.map((category) => category.id) ?? [];
    if (categoryIds.length === 0) return { data: [], count: 0 };
  }

  let splitParentIds: string[] = [];
  if (categoryIds) {
    const { data: allocationParents, error: allocationError } = await supabase
      .from("transactions")
      .select("parent_id")
      .eq("user_id", userId)
      .not("parent_id", "is", null)
      .in("category_id", categoryIds);

    if (allocationError) throw allocationError;
    splitParentIds = Array.from(
      new Set(
        (allocationParents ?? [])
          .map((row) => row.parent_id)
          .filter((id): id is string => Boolean(id))
      )
    );
  }

  let query = supabase
    .from("transactions")
    .select(
      `
      id, date, description, amount, category_id, account_id,
      status, is_split, parent_id, source, upload_source, created_at,
      plaid_transaction_id, not_duplicate,
      budget_categories(group_name, line_item_name, category_type),
      accounts(name, institution)
    `,
      { count: "exact" }
    )
    .eq("user_id", userId)
    .is("parent_id", null) // exclude split children from main list
    .or("external_status.is.null,external_status.neq.removed");

  if (filters.search) {
    query = query.ilike("description", `%${filters.search}%`);
  }
  if (filters.uncategorizedOnly) {
    query = query
      .is("category_id", null)
      .or("is_split.is.null,is_split.eq.false");
  } else if (categoryIds) {
    const categoryList = categoryIds.join(",");
    if (splitParentIds.length > 0) {
      query = query.or(
        `category_id.in.(${categoryList}),id.in.(${splitParentIds.join(",")})`
      );
    } else {
      query = query.in("category_id", categoryIds);
    }
  }
  if (filters.accountId) {
    query = query.eq("account_id", filters.accountId);
  }
  if (filters.status) {
    query = query.eq("status", filters.status);
  }
  if (filters.dateFrom) {
    query = query.gte("date", filters.dateFrom);
  }
  if (filters.dateTo) {
    query = query.lte("date", filters.dateTo);
  }

  const ascending = sort.direction === "asc";
  const sortColumn =
    sort.field === "group"
      ? "budget_categories(group_name)"
      : sort.field === "lineItem"
        ? "budget_categories(line_item_name)"
        : sort.field === "account"
          ? "accounts(name)"
          : sort.field;

  query = query
    .order(sortColumn, { ascending, nullsFirst: false })
    .order("created_at", { ascending: false });

  const from = page * pageSize;
  const to = from + pageSize - 1;
  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) throw error;

  const transactions =
    (data as Omit<Transaction, "notes" | "allocations">[]) ?? [];
  const transactionIds = transactions.map((transaction) => transaction.id);
  const [notes, allocations] = await Promise.all([
    getTransactionNotes(transactionIds),
    getSplitAllocations(transactionIds, userId),
  ]);

  return {
    data: transactions.map((transaction) => ({
      ...transaction,
      notes: notes[transaction.id] ?? null,
      allocations: allocations[transaction.id] ?? [],
    })),
    count: count ?? 0,
  };
}

async function getSplitAllocations(transactionIds: string[], userId: string) {
  if (transactionIds.length === 0) {
    return {} as Record<string, SplitAllocation[]>;
  }

  const { data, error } = await supabase
    .from("transactions")
    .select(
      `
      id, parent_id, amount, category_id, description,
      budget_categories(group_name, line_item_name, category_type)
    `
    )
    .eq("user_id", userId)
    .in("parent_id", transactionIds)
    .order("created_at", { ascending: true });

  if (error) throw error;

  const grouped: Record<string, SplitAllocation[]> = {};
  for (const allocation of data ?? []) {
    if (!allocation.parent_id || !allocation.category_id) continue;
    const relation = Array.isArray(allocation.budget_categories)
      ? allocation.budget_categories[0]
      : allocation.budget_categories;
    (grouped[allocation.parent_id] ??= []).push({
      id: allocation.id,
      amount: Number(allocation.amount),
      category_id: allocation.category_id,
      description: allocation.description,
      budget_categories: relation ?? null,
    });
  }
  return grouped;
}

export async function updateTransactionCategory(
  transactionId: string,
  categoryId: string | null
) {
  const userId = await getCurrentUserId();
  const { error } = await supabase
    .from("transactions")
    .update({ category_id: categoryId })
    .eq("id", transactionId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function updateTransactionNotes(
  transactionId: string,
  notes: string | null
) {
  const response = await fetch("/api/transactions/notes", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactionId, notes }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.error ?? "Could not save transaction note");
  }
}

async function getTransactionNotes(transactionIds: string[]) {
  if (transactionIds.length === 0) return {} as Record<string, string>;

  const params = new URLSearchParams({ ids: transactionIds.join(",") });
  const response = await fetch(`/api/transactions/notes?${params}`);
  if (!response.ok) return {} as Record<string, string>;

  const result = (await response.json()) as { notes?: Record<string, string> };
  return result.notes ?? {};
}

export async function bulkUpdateCategory(
  transactionIds: string[],
  categoryId: string | null
) {
  const userId = await getCurrentUserId();
  const { error } = await supabase
    .from("transactions")
    .update({ category_id: categoryId })
    .in("id", transactionIds)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function bulkConfirm(transactionIds: string[]) {
  const userId = await getCurrentUserId();
  const { error } = await supabase
    .from("transactions")
    .update({ status: "Confirmed" })
    .in("id", transactionIds)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function deleteTransactions(transactionIds: string[]) {
  const userId = await getCurrentUserId();
  const { error } = await supabase
    .from("transactions")
    .delete()
    .in("id", transactionIds)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function findDuplicates() {
  const { data, error } = await supabase.rpc("find_duplicate_transactions");
  if (error) throw error;
  return data ?? [];
}

export async function bulkUpdateAccount(
  transactionIds: string[],
  accountId: string
) {
  const userId = await getCurrentUserId();
  const { error } = await supabase
    .from("transactions")
    .update({ account_id: accountId })
    .in("id", transactionIds)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function bulkUpdateStatus(
  transactionIds: string[],
  status: string
) {
  const userId = await getCurrentUserId();
  const { error } = await supabase
    .from("transactions")
    .update({ status })
    .in("id", transactionIds)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function bulkUpdateDate(
  transactionIds: string[],
  date: string
) {
  const userId = await getCurrentUserId();
  const { error } = await supabase
    .from("transactions")
    .update({ date })
    .in("id", transactionIds)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function bulkUpdateDescription(
  transactionIds: string[],
  description: string
) {
  const userId = await getCurrentUserId();
  const { error } = await supabase
    .from("transactions")
    .update({ description })
    .in("id", transactionIds)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function markNotDuplicate(
  transactionIds: string[],
  notDuplicate: boolean
) {
  const userId = await getCurrentUserId();
  const { error } = await supabase
    .from("transactions")
    .update({ not_duplicate: notDuplicate })
    .in("id", transactionIds)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function splitTransaction(
  parentId: string,
  allocations: { category_id: string; amount: number; description?: string }[]
) {
  const { error } = await supabase.rpc("save_transaction_split", {
    p_parent_id: parentId,
    p_allocations: allocations,
  });
  if (error) throw error;
}

export async function unsplitTransaction(parentId: string) {
  const { error } = await supabase.rpc("unsplit_transaction", {
    p_parent_id: parentId,
  });
  if (error) throw error;
}
