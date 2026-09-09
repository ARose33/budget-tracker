import { supabase } from "@/lib/supabase/client";
import { z } from "zod";

export interface Transaction {
  row_version: number;
  archived_at: string | null;
  external_status: string | null;
  id: string;
  date: string;
  description: string | null;
  notes: string | null;
  amount: number;
  category_id: string | null;
  categorization_status: CategorizationStatus;
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
    category_type: string | null;
  } | null;
  accounts?: {
    name: string;
    institution: string;
  } | null;
}

export interface SplitAllocation {
  id: string;
  amount: number;
  category_id: string | null;
  description: string | null;
  budget_categories?: {
    group_name: string;
    line_item_name: string;
    category_type: string | null;
  } | null;
}

export interface TransactionFilters {
  id?: string;
  history?: "active" | "all" | "archived" | "removed";
  search?: string;
  categoryType?: "Income" | "Expense";
  categoryGroup?: string;
  categoryId?: string;
  accountId?: string;
  status?: CategorizationStatus;
  uncategorizedOnly?: boolean;
  dateFrom?: string;
  dateTo?: string;
}

export type CategorizationStatus = "uncategorized" | "pending" | "final";

export interface CategorizationCounts {
  eligible: number;
  uncategorized: number;
  pending: number;
  final: number;
}

export interface CategorizationBatchResult {
  processed: number;
  matchedFromHistory: number;
  inferredByModel: number;
  skipped: number;
  remaining: number;
  done: boolean;
  queuedAtStart?: number;
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

const category = z.object({
  group_name: z.string(),
  line_item_name: z.string(),
  category_type: z.string().nullable(),
});
const transactionSchema = z.object({
  id: z.string(),
  date: z.string(),
  description: z.string().nullable(),
  notes: z.string().nullable(),
  amount: z.number(),
  category_id: z.string().nullable(),
  account_id: z.string().nullable(),
  categorization_status: z.enum(["uncategorized", "pending", "final"]),
  status: z.string().nullable(),
  is_split: z.boolean().nullable(),
  parent_id: z.string().nullable(),
  source: z.string().nullable(),
  upload_source: z.string().nullable(),
  created_at: z.string().nullable(),
  plaid_transaction_id: z.string().nullable(),
  not_duplicate: z.boolean(),
  row_version: z.number(),
  archived_at: z.string().nullable(),
  external_status: z.string().nullable(),
  budget_categories: category.nullable(),
  accounts: z.object({ name: z.string(), institution: z.string() }).nullable(),
  allocations: z.array(
    z.object({
      id: z.string(),
      amount: z.number(),
      category_id: z.string().nullable(),
      description: z.string().nullable(),
      budget_categories: category.nullable(),
    }),
  ),
});
export async function getTransactions(
  page = 0,
  pageSize = 50,
  filters: TransactionFilters = {},
  sort: TransactionSort = { field: "date", direction: "desc" },
): Promise<{ data: Transaction[]; count: number }> {
  const { data, error } = await supabase.rpc("stackmint_transactions", {
    p_filters: { ...filters },
    p_page: page,
    p_size: pageSize,
    p_sort: sort.field,
    p_desc: sort.direction === "desc",
  });
  if (error) throw error;
  return z
    .object({ count: z.number(), data: z.array(transactionSchema) })
    .parse(data);
}
export async function getTransaction(id: string) {
  const result = await getTransactions(0, 1, { id, history: "all" });
  if (!result.data[0]) throw new Error("Transaction not found.");
  return result.data[0];
}
export type TransactionVersion = { id: string; version: number };
export const observedVersion = (
  transaction: Transaction,
): TransactionVersion => ({
  id: transaction.id,
  version: transaction.row_version,
});
export async function editTransactions(
  items: TransactionVersion[],
  patch: {
    category_id?: string | null;
    account_id?: string;
    description?: string;
    date?: string;
    categorization_status?: CategorizationStatus;
    not_duplicate?: boolean;
    archived?: boolean;
  },
) {
  const { error } = await supabase.rpc("stackmint_edit_transactions", {
    p_items: items.map((item) => ({ ...item })),
    p_patch: { ...patch },
  });
  if (error) throw error;
}
export const updateTransactionCategory = (
  item: TransactionVersion,
  categoryId: string | null,
) =>
  editTransactions([item], {
    category_id: categoryId,
    categorization_status: categoryId ? "final" : "uncategorized",
  });
export const bulkUpdateCategory = (
  items: TransactionVersion[],
  categoryId: string | null,
) =>
  editTransactions(items, {
    category_id: categoryId,
    categorization_status: categoryId ? "final" : "uncategorized",
  });
export const finalizeTransactions = (items: TransactionVersion[]) =>
  editTransactions(items, { categorization_status: "final" });
export const archiveTransactions = (
  items: TransactionVersion[],
  archived = true,
) => editTransactions(items, { archived });
export const bulkUpdateAccount = (
  items: TransactionVersion[],
  accountId: string,
) => editTransactions(items, { account_id: accountId });
export const bulkUpdateDate = (items: TransactionVersion[], date: string) =>
  editTransactions(items, { date });
export const bulkUpdateDescription = (
  items: TransactionVersion[],
  description: string,
) => editTransactions(items, { description });
export const markNotDuplicate = (
  items: TransactionVersion[],
  notDuplicate: boolean,
) => editTransactions(items, { not_duplicate: notDuplicate });
export async function splitTransaction(
  parent: TransactionVersion,
  allocations: {
    id?: string;
    category_id: string;
    amount: number;
    description?: string;
  }[],
) {
  const { error } = await supabase.rpc("stackmint_save_split", {
    p_parent_id: parent.id,
    p_expected_version: parent.version,
    p_allocations: allocations.map((allocation) => ({ ...allocation })),
  });
  if (error) throw error;
}
export async function unsplitTransaction(parent: TransactionVersion) {
  const { error } = await supabase.rpc("stackmint_unsplit", {
    p_parent_id: parent.id,
    p_expected_version: parent.version,
  });
  if (error) throw error;
}
const noteSchema = z.object({
  content: z.string(),
  version: z.number(),
  hash: z.string(),
});
export type NoteState = z.infer<typeof noteSchema>;
export async function getTransactionNote(
  transactionId: string,
): Promise<NoteState> {
  const response = await fetch(
    "/api/transactions/notes?ids=" + encodeURIComponent(transactionId),
  );
  if (!response.ok)
    throw new Error("This note could not be loaded. Retry before editing.");
  return noteSchema.parse(await response.json());
}
export async function updateTransactionNotes(
  transactionId: string,
  notes: string,
  original: NoteState,
) {
  const response = await fetch("/api/transactions/notes", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transactionId,
      notes,
      expectedVersion: original.version,
      expectedHash: original.hash,
    }),
  });
  if (!response.ok)
    throw new Error(
      response.status === 409
        ? "This note changed. Close and reopen it before saving."
        : "Could not save transaction note.",
    );
  return noteSchema.parse(await response.json());
}
export async function getCategorizationCounts(): Promise<CategorizationCounts> {
  const { data, error } = await supabase.rpc(
    "stackmint_categorization_counts",
    {},
  );
  if (error) throw error;
  return z
    .object({
      uncategorized: z.number(),
      pending: z.number(),
      final: z.number(),
      eligible: z.number(),
    })
    .parse(data);
}
export async function categorizeNextTransactions(runId: string) {
  const response = await fetch("/api/transactions/categorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId }),
  });
  const result = (await response.json().catch(() => null)) as
    (CategorizationBatchResult & { error?: string }) | null;
  if (!response.ok || !result)
    throw new Error(result?.error ?? "Could not categorize transactions");
  return result;
}
