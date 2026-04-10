import { supabase } from "@/lib/supabase/client";

export interface Transaction {
  id: string;
  date: string;
  description: string | null;
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

export interface TransactionFilters {
  search?: string;
  categoryId?: string;
  accountId?: string;
  status?: string;
  uncategorizedOnly?: boolean;
  dateFrom?: string;
  dateTo?: string;
}

export async function getTransactions(
  page: number = 0,
  pageSize: number = 50,
  filters: TransactionFilters = {}
): Promise<{ data: Transaction[]; count: number }> {
  let query = supabase
    .from("transactions")
    .select(
      `
      id, date, description, amount, category_id, account_id,
      status, is_split, parent_id, source, upload_source, created_at,
      plaid_transaction_id,
      budget_categories(group_name, line_item_name, category_type),
      accounts(name, institution)
    `,
      { count: "exact" }
    )
    .is("parent_id", null) // exclude split children from main list
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });

  if (filters.search) {
    query = query.ilike("description", `%${filters.search}%`);
  }
  if (filters.categoryId) {
    query = query.eq("category_id", filters.categoryId);
  }
  if (filters.accountId) {
    query = query.eq("account_id", filters.accountId);
  }
  if (filters.status) {
    query = query.eq("status", filters.status);
  }
  if (filters.uncategorizedOnly) {
    query = query.is("category_id", null);
  }
  if (filters.dateFrom) {
    query = query.gte("date", filters.dateFrom);
  }
  if (filters.dateTo) {
    query = query.lte("date", filters.dateTo);
  }

  const from = page * pageSize;
  const to = from + pageSize - 1;
  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) throw error;

  return { data: (data as Transaction[]) ?? [], count: count ?? 0 };
}

export async function updateTransactionCategory(
  transactionId: string,
  categoryId: string | null
) {
  const { error } = await supabase
    .from("transactions")
    .update({ category_id: categoryId })
    .eq("id", transactionId);
  if (error) throw error;
}

export async function bulkUpdateCategory(
  transactionIds: string[],
  categoryId: string
) {
  const { error } = await supabase
    .from("transactions")
    .update({ category_id: categoryId })
    .in("id", transactionIds);
  if (error) throw error;
}

export async function bulkConfirm(transactionIds: string[]) {
  const { error } = await supabase
    .from("transactions")
    .update({ status: "Confirmed" })
    .in("id", transactionIds);
  if (error) throw error;
}

export async function deleteTransactions(transactionIds: string[]) {
  const { error } = await supabase
    .from("transactions")
    .delete()
    .in("id", transactionIds);
  if (error) throw error;
}

export async function findDuplicates() {
  const { data, error } = await supabase.rpc("find_duplicate_transactions");
  if (error) throw error;
  return data ?? [];
}

export async function splitTransaction(
  parentId: string,
  children: { category_id: string; amount: number; description?: string }[]
) {
  // Get parent transaction
  const { data: parent, error: parentError } = await supabase
    .from("transactions")
    .select("*")
    .eq("id", parentId)
    .single();

  if (parentError) throw parentError;

  // Mark parent as split
  await supabase
    .from("transactions")
    .update({ is_split: true })
    .eq("id", parentId);

  // Insert children
  const childRows = children.map((c) => ({
    date: parent.date,
    description: c.description || parent.description,
    amount: c.amount,
    category_id: c.category_id,
    account_id: parent.account_id,
    status: parent.status,
    parent_id: parentId,
    is_split: true,
    source: parent.source,
  }));

  const { error } = await supabase.from("transactions").insert(childRows);
  if (error) throw error;
}
