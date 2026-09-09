"use client";

import { Suspense, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getTransactions,
  updateTransactionCategory,
  bulkUpdateCategory,
  bulkUpdateAccount,
  finalizeTransactions,
  getCategorizationCounts,
  bulkUpdateDescription,
  bulkUpdateDate,
  archiveTransactions,
  observedVersion,
  markNotDuplicate,
  type TransactionFilters,
  type TransactionSort,
  type TransactionSortField,
  type Transaction,
} from "@/lib/queries/transactions";
import { TransactionFiltersBar } from "@/components/transactions/transaction-filters";
import { BulkActionsBar } from "@/components/transactions/bulk-actions-bar";
import { CategorySelect } from "@/components/transactions/category-select";
import { SplitTransactionDialog } from "@/components/transactions/split-transaction-dialog";
import { CategorizeTransactionsDialog } from "@/components/transactions/categorize-transactions-dialog";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  StickyNote,
  Scissors,
  AlertTriangle,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { invalidateFinance, saveError } from "@/lib/finance/cache";
import { TransactionEditor } from "@/components/transactions/transaction-editor";
import {
  parseTransactionFilters,
  updateTransactionFilterParams,
} from "@/lib/transaction-filter-params";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(Math.abs(amount));
}

function TransactionsContent() {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [page, setPage] = useState(0);
  const filters = parseTransactionFilters(searchParams);
  const [sort, setSort] = useState<TransactionSort>({
    field: "date",
    direction: "desc",
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const pageSize = 50;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const handleFiltersChange = (nextFilters: TransactionFilters) => {
    setPage(0);
    setSelected(new Set());

    const params = updateTransactionFilterParams(searchParams, nextFilters);
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      query ? `${pathname}?${query}` : pathname
    );
  };

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["transactions", page, filters, sort],
    queryFn: () => getTransactions(page, pageSize, filters, sort),
  });

  const { data: categorizationCounts } = useQuery({
    queryKey: ["categorization-counts"],
    queryFn: getCategorizationCounts,
  });

  const transactions = data?.data ?? [];
  const totalCount = data?.count ?? 0;
  const totalPages = Math.ceil(totalCount / pageSize);

  const allSelected = transactions.length > 0 && transactions.every((t) => selected.has(t.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(transactions.map((t) => t.id)));
    }
  };

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const versions = (ids: string[]) => ids.map(id => {
    const transaction = transactions.find(row => row.id === id);
    if (!transaction) throw new Error("Selection changed. Select these transactions again.");
    return observedVersion(transaction);
  });
  const invalidate = () => {
    void invalidateFinance(queryClient);
    setSelected(new Set());
  };
  const onSaveError = (error: unknown) => toast.error(saveError(error));

  const categoryMutation = useMutation({
    mutationFn: ({ id, categoryId }: { id: string; categoryId: string | null }) =>
      updateTransactionCategory(versions([id])[0], categoryId),
    onSuccess: invalidate,
    onError: onSaveError,
  });


  const bulkCategoryMutation = useMutation({
    onError: onSaveError,
    mutationFn: (categoryId: string | null) =>
      bulkUpdateCategory(versions(Array.from(selected)), categoryId),
    onSuccess: () => {
      toast.success(`Updated ${selected.size} transactions`);
      invalidate();
    },
  });

  const deleteMutation = useMutation({
    onError: onSaveError,
    mutationFn: () => archiveTransactions(versions(Array.from(selected))),
    onSuccess: () => {
      toast.success(`Archived ${selected.size} transactions; history retained`);
      invalidate();
    },
  });

  const notDuplicateMutation = useMutation({
    onError: onSaveError,
    mutationFn: () => markNotDuplicate(versions(Array.from(selected)), true),
    onSuccess: () => {
      toast.success(`Marked ${selected.size} transactions as verified (not duplicate)`);
      invalidate();
    },
  });

  const bulkAccountMutation = useMutation({
    onError: onSaveError,
    mutationFn: (accountId: string) =>
      bulkUpdateAccount(versions(Array.from(selected)), accountId),
    onSuccess: () => {
      toast.success(`Updated account on ${selected.size} transactions`);
      invalidate();
    },
  });

  const finalizeMutation = useMutation({
    onError: onSaveError,
    mutationFn: (transactionIds: string[]) => finalizeTransactions(versions(transactionIds)),
    onSuccess: () => {
      toast.success("Marked transaction Final");
      invalidate();
    },
  });

  const bulkFinalizeMutation = useMutation({
    onError: onSaveError,
    mutationFn: () => finalizeTransactions(versions(Array.from(selected))),
    onSuccess: () => {
      toast.success(`Marked ${selected.size} transactions Final`);
      invalidate();
    },
  });

  const bulkDescriptionMutation = useMutation({
    onError: onSaveError,
    mutationFn: (description: string) =>
      bulkUpdateDescription(versions(Array.from(selected)), description),
    onSuccess: () => {
      toast.success(`Updated description on ${selected.size} transactions`);
      invalidate();
    },
  });

  const bulkDateMutation = useMutation({
    onError: onSaveError,
    mutationFn: (date: string) =>
      bulkUpdateDate(versions(Array.from(selected)), date),
    onSuccess: () => {
      toast.success(`Updated date on ${selected.size} transactions`);
      invalidate();
    },
  });

  const handleSort = (field: TransactionSortField) => {
    setSort((current) => ({
      field,
      direction:
        current.field === field && current.direction === "asc" ? "desc" : "asc",
    }));
    setPage(0);
    setSelected(new Set());
  };

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold">Transactions</h2>
        <CategorizeTransactionsDialog
          uncategorizedCount={categorizationCounts?.eligible ?? 0}
        />
      </div>

      <TransactionFiltersBar
        filters={filters}
        onChange={handleFiltersChange}
        statusCounts={categorizationCounts}
      />

      <ConfirmAction open={confirmArchive} onOpenChange={setConfirmArchive} title={"Archive " + selected.size + " selected transactions?"} description="These records leave active totals and remain accessible in transaction history. You can restore them later." confirmLabel="Confirm archive" pending={deleteMutation.isPending} onConfirm={() => deleteMutation.mutate(undefined, { onSuccess: () => setConfirmArchive(false) })} />
      <BulkActionsBar
        selectedCount={selected.size}
        onSetCategory={(cid) => bulkCategoryMutation.mutate(cid)}
        onSetAccount={(aid) => bulkAccountMutation.mutate(aid)}
        onFinalize={() => bulkFinalizeMutation.mutate()}
        onSetDescription={(d) => bulkDescriptionMutation.mutate(d)}
        onSetDate={(d) => bulkDateMutation.mutate(d)}
        onArchive={() => setConfirmArchive(true)}
        onMarkNotDuplicate={() => notDuplicateMutation.mutate()}
      />

      {editingId ? <TransactionEditor id={editingId} close={() => setEditingId(null)} /> : null}
      {isError ? <div role="alert" className="rounded border p-5">{saveError(error)} <Button variant="outline" onClick={() => refetch()}>Retry</Button></div> : isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="p-3 w-10">
                    <Checkbox aria-label="Select all visible transactions"
                      checked={allSelected}
                      onCheckedChange={toggleAll}
                    />
                  </th>
                  <SortableHeader field="date" sort={sort} onSort={handleSort} className="hidden sm:table-cell">Date</SortableHeader>
                  <SortableHeader field="description" sort={sort} onSort={handleSort}>Description</SortableHeader>
                  <SortableHeader field="amount" sort={sort} onSort={handleSort} align="right">Amount</SortableHeader>
                  <SortableHeader field="group" sort={sort} onSort={handleSort} className="hidden lg:table-cell w-[140px]">Group</SortableHeader>
                  <SortableHeader field="lineItem" sort={sort} onSort={handleSort} className="hidden md:table-cell w-[180px]">Line Item</SortableHeader>
                  <SortableHeader field="account" sort={sort} onSort={handleSort} className="hidden lg:table-cell">Account</SortableHeader>
                  <SortableHeader field="status" sort={sort} onSort={handleSort} align="center" className="hidden md:table-cell">Status</SortableHeader>
                  <th className="hidden md:table-cell text-center p-3 w-16">Note</th>
                  <th className="hidden md:table-cell text-center p-3 w-20">Actions</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <TransactionRow
                    key={t.id}
                    transaction={t}
                    isSelected={selected.has(t.id)}
                    onToggle={() => toggleOne(t.id)}
                    onCategoryChange={(cid) =>
                      categoryMutation.mutate({ id: t.id, categoryId: cid })
                    }
                    onEdit={() => setEditingId(t.id)}
                    onFinalize={() => finalizeMutation.mutate([t.id])}
                    onSplitChange={invalidate}
                  />
                ))}
                {transactions.length === 0 && (
                  <tr>
                    <td
                      colSpan={10}
                      className="text-center py-12 text-muted-foreground"
                    >
                      No transactions found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {totalCount ? page * pageSize + 1 : 0}-
              {Math.min((page + 1) * pageSize, totalCount)} of{" "}
              {totalCount.toLocaleString()}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => { setSelected(new Set()); setPage((p) => p - 1); }}
              >
                <ChevronLeft className="h-4 w-4" />
                Prev
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page + 1} of {Math.max(1, totalPages)}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages - 1}
                onClick={() => { setSelected(new Set()); setPage((p) => p + 1); }}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SortableHeader({
  field,
  sort,
  onSort,
  children,
  align = "left",
  className,
}: {
  field: TransactionSortField;
  sort: TransactionSort;
  onSort: (field: TransactionSortField) => void;
  children: React.ReactNode;
  align?: "left" | "center" | "right";
  className?: string;
}) {
  const active = sort.field === field;
  const Icon = active
    ? sort.direction === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;

  return (
    <th className={cn("p-3", className)}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          "flex w-full items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          align === "right" && "justify-end",
          align === "center" && "justify-center",
          align === "left" && "justify-start"
        )}
        aria-label={`Sort by ${String(children)}`}
      >
        {children}
        <Icon
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            active ? "text-foreground" : "text-muted-foreground/50"
          )}
        />
      </button>
    </th>
  );
}

export default function TransactionsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <TransactionsContent />
    </Suspense>
  );
}

function TransactionRow({
  transaction: t,
  isSelected,
  onToggle,
  onCategoryChange,
  onEdit,
  onFinalize,
  onSplitChange,
}: {
  transaction: Transaction;
  isSelected: boolean;
  onToggle: () => void;
  onCategoryChange: (categoryId: string | null) => void;
  onEdit: () => void;
  onFinalize: () => void;
  onSplitChange: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isExpense = t.amount < 0;
  const groupName = t.is_split
    ? `${t.allocations.length} allocations`
    : t.budget_categories?.group_name ?? "Uncategorized";
  const lineItemName = t.budget_categories?.line_item_name ?? "Uncategorized";
  const parentCents = Math.round(t.amount * 100);
  const allocationCents = t.allocations.reduce(
    (sum, allocation) => sum + Math.round(allocation.amount * 100),
    0
  );
  const isBalanced = t.is_split && parentCents === allocationCents;

  return (
    <>
    <tr
      className={cn("border-t hover:bg-accent/50", isSelected && "bg-accent/30")}
      aria-expanded={t.is_split ? expanded : undefined}
    >
      <td className="p-3">
        <Checkbox aria-label={"Select " + (t.description || "transaction") + " on " + t.date} checked={isSelected} onCheckedChange={onToggle} />
      </td>
      <td className="hidden sm:table-cell p-3 whitespace-nowrap">{t.date}</td>
      <td className="p-3 max-w-[150px] sm:max-w-[250px] truncate" title={t.description ?? ""}>
        <button className="text-left hover:underline" onClick={onEdit}>{t.description || "Transaction"}</button>
        <p className="md:hidden text-xs text-muted-foreground truncate">{t.date} · {t.is_split ? "Split" : lineItemName}</p>
        {t.archived_at ? <Badge variant="outline">Archived</Badge> : t.external_status === "removed" ? <Badge variant="outline">Removed at source</Badge> : null}
        {t.is_split && (
          <Badge
            variant="outline"
            className={cn(
              "ml-2 text-xs",
              !isBalanced && "border-amber-300 text-amber-700"
            )}
          >
            {!isBalanced && <AlertTriangle className="mr-1 h-3 w-3" />}
            {isBalanced ? "Split" : "Split needs attention"}
          </Badge>
        )}
        {t.not_duplicate && (
          <Badge variant="outline" className="ml-2 text-xs border-blue-200 text-blue-600">
            Verified
          </Badge>
        )}
      </td>
      <td
        className={cn(
          "p-3 text-right font-medium whitespace-nowrap",
          isExpense ? "text-red-500" : "text-emerald-600"
        )}
      >
        {isExpense ? "-" : "+"}
        {formatCurrency(t.amount)}
      </td>
      <td
        className="hidden lg:table-cell p-3 max-w-[140px] truncate text-muted-foreground text-xs"
        title={groupName}
      >
        {groupName}
      </td>
      <td className="hidden md:table-cell p-3">
        {t.is_split ? (
          <span className="text-xs text-muted-foreground">Multiple categories</span>
        ) : (
          <CategorySelect
            value={t.category_id}
            onValueChange={onCategoryChange}
            placeholder={lineItemName}
            className="h-8 text-xs"
            displayMode="lineItem"
          />
        )}
      </td>
      <td className="hidden lg:table-cell p-3 text-muted-foreground text-xs">
        {t.accounts?.name ?? "—"}
      </td>
      <td className="hidden md:table-cell p-3 text-center">
        <Badge
          variant="outline"
          className={cn(
            "text-xs",
            t.categorization_status === "final" &&
              "border-emerald-200 bg-emerald-50 text-emerald-700",
            t.categorization_status === "pending" &&
              "border-amber-200 bg-amber-50 text-amber-700",
            t.categorization_status === "uncategorized" &&
              "border-slate-200 text-slate-600"
          )}
        >
          {t.categorization_status === "final"
            ? "Final"
            : t.categorization_status === "pending"
              ? "To review"
              : "Uncategorized"}
        </Badge>
      </td>
      <td className="hidden md:table-cell p-3 text-center">
        <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label="Open transaction details and note"><StickyNote className="size-4" /></Button>
      </td>
      <td className="hidden md:table-cell p-3 text-center">
        <div className="flex items-center justify-center gap-1">
          {t.categorization_status === "pending" && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onFinalize}
              aria-label="Approve category and mark Final"
              title="Approve category and mark Final"
            >
              <Check className="h-4 w-4 text-emerald-600" />
            </Button>
          )}
          {t.is_split && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setExpanded((current) => !current)}
              aria-label={expanded ? "Hide split allocations" : "Show split allocations"}
              title={expanded ? "Hide allocations" : "Show allocations"}
            >
              <ChevronRight
                className={cn("h-4 w-4 transition-transform", expanded && "rotate-90")}
              />
            </Button>
          )}
          <SplitTransactionDialog transaction={t} onSaved={onSplitChange} />
        </div>
      </td>
    </tr>
    {t.is_split && expanded && (
      <tr className="border-t bg-muted/20">
        <td colSpan={10} className="px-4 py-3">
          <div className="ml-10 space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Scissors className="h-3.5 w-3.5" />
              Split allocations
            </div>
            {t.allocations.map((allocation) => (
              <div
                key={allocation.id}
                className="grid gap-2 rounded-md border bg-background px-3 py-2 text-xs sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
              >
                <span className="font-medium">
                  {allocation.budget_categories
                    ? `${allocation.budget_categories.group_name}: ${allocation.budget_categories.line_item_name}`
                    : "Unknown category"}
                </span>
                <span className="truncate text-muted-foreground" title={allocation.description ?? ""}>
                  {allocation.description || t.description}
                </span>
                <span
                  className={cn(
                    "text-right font-medium tabular-nums",
                    allocation.amount < 0 ? "text-red-500" : "text-emerald-600"
                  )}
                >
                  {allocation.amount < 0 ? "-" : "+"}
                  {formatCurrency(allocation.amount)}
                </span>
              </div>
            ))}
            {!isBalanced && (
              <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Allocations total {formatCurrency(allocationCents / 100)} but the bank transaction is {formatCurrency(parentCents / 100)}. Edit the split to rebalance it.
              </div>
            )}
          </div>
        </td>
      </tr>
    )}
    </>
  );
}
