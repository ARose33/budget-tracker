import type { TransactionFilters } from "@/lib/queries/transactions";

type ReadableSearchParams = Pick<URLSearchParams, "get" | "toString">;

const FILTER_PARAM_KEYS = [
  "search",
  "categoryType",
  "categoryGroup",
  "categoryId",
  "accountId",
  "status",
  "uncategorized",
  "dateFrom",
  "dateTo",
] as const;

function parseCategoryType(value: string | null) {
  if (value?.toLowerCase() === "income") return "Income" as const;
  if (value?.toLowerCase() === "expense") return "Expense" as const;
  return undefined;
}

export function parseTransactionFilters(
  searchParams: ReadableSearchParams
): TransactionFilters {
  const uncategorized = searchParams.get("uncategorized");

  return {
    search: searchParams.get("search") || undefined,
    categoryType: parseCategoryType(searchParams.get("categoryType")),
    categoryGroup: searchParams.get("categoryGroup") || undefined,
    categoryId: searchParams.get("categoryId") || undefined,
    accountId: searchParams.get("accountId") || undefined,
    status: searchParams.get("status") || undefined,
    uncategorizedOnly:
      uncategorized === "true" || uncategorized === "1" || undefined,
    dateFrom: searchParams.get("dateFrom") || undefined,
    dateTo: searchParams.get("dateTo") || undefined,
  };
}

export function updateTransactionFilterParams(
  currentSearchParams: ReadableSearchParams,
  filters: TransactionFilters
) {
  const params = new URLSearchParams(currentSearchParams.toString());

  for (const key of FILTER_PARAM_KEYS) {
    params.delete(key);
  }

  if (filters.search) params.set("search", filters.search);
  if (filters.categoryType) params.set("categoryType", filters.categoryType);
  if (filters.categoryGroup) params.set("categoryGroup", filters.categoryGroup);
  if (filters.categoryId) params.set("categoryId", filters.categoryId);
  if (filters.accountId) params.set("accountId", filters.accountId);
  if (filters.status) params.set("status", filters.status);
  if (filters.uncategorizedOnly) params.set("uncategorized", "true");
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);

  return params;
}

export function createTransactionsHref(filters: TransactionFilters) {
  const params = updateTransactionFilterParams(new URLSearchParams(), filters);
  const query = params.toString();
  return query ? `/transactions?${query}` : "/transactions";
}
