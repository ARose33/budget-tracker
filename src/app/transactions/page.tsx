"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getTransactions,
  updateTransactionCategory,
  updateTransactionNotes,
  bulkUpdateCategory,
  bulkUpdateAccount,
  bulkUpdateStatus,
  bulkUpdateDescription,
  bulkUpdateDate,
  deleteTransactions,
  markNotDuplicate,
  type TransactionFilters,
  type TransactionSort,
  type TransactionSortField,
  type Transaction,
} from "@/lib/queries/transactions";
import { TransactionFiltersBar } from "@/components/transactions/transaction-filters";
import { BulkActionsBar } from "@/components/transactions/bulk-actions-bar";
import { CategorySelect } from "@/components/transactions/category-select";
import { CsvImportDialog } from "@/components/transactions/csv-import-dialog";
import { PdfStatementImportDialog } from "@/components/transactions/pdf-statement-import-dialog";
import { SplitTransactionDialog } from "@/components/transactions/split-transaction-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ChevronLeft,
  ChevronRight,
  Upload,
  FileText,
  Loader2,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  StickyNote,
  Scissors,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase/client";
import { getCurrentUserId } from "@/lib/supabase/auth";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(Math.abs(amount));
}

export default function TransactionsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState<TransactionFilters>({});
  const [sort, setSort] = useState<TransactionSort>({
    field: "date",
    direction: "desc",
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [csvOpen, setCsvOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const pageSize = 50;

  const { data, isLoading } = useQuery({
    queryKey: ["transactions", page, filters, sort],
    queryFn: () => getTransactions(page, pageSize, filters, sort),
  });

  const { data: uncatData } = useQuery({
    queryKey: ["uncategorized-count"],
    queryFn: async () => {
      const userId = await getCurrentUserId();
      const { count } = await supabase
        .from("transactions")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .is("category_id", null)
        .is("parent_id", null)
        .or("is_split.is.null,is_split.eq.false")
        .or("external_status.is.null,external_status.neq.removed");
      return count ?? 0;
    },
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

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["uncategorized-count"] });
    queryClient.invalidateQueries({ queryKey: ["budget"] });
    setSelected(new Set());
  };

  const categoryMutation = useMutation({
    mutationFn: ({ id, categoryId }: { id: string; categoryId: string | null }) =>
      updateTransactionCategory(id, categoryId),
    onSuccess: invalidate,
  });

  const notesMutation = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes: string | null }) =>
      updateTransactionNotes(id, notes),
    onSuccess: () => {
      toast.success("Transaction note saved");
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
    onError: () => toast.error("Could not save transaction note"),
  });

  const bulkCategoryMutation = useMutation({
    mutationFn: (categoryId: string | null) =>
      bulkUpdateCategory(Array.from(selected), categoryId),
    onSuccess: () => {
      toast.success(`Updated ${selected.size} transactions`);
      invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTransactions(Array.from(selected)),
    onSuccess: () => {
      toast.success(`Deleted ${selected.size} transactions`);
      invalidate();
    },
  });

  const notDuplicateMutation = useMutation({
    mutationFn: () => markNotDuplicate(Array.from(selected), true),
    onSuccess: () => {
      toast.success(`Marked ${selected.size} transactions as verified (not duplicate)`);
      invalidate();
    },
  });

  const bulkAccountMutation = useMutation({
    mutationFn: (accountId: string) =>
      bulkUpdateAccount(Array.from(selected), accountId),
    onSuccess: () => {
      toast.success(`Updated account on ${selected.size} transactions`);
      invalidate();
    },
  });

  const bulkStatusMutation = useMutation({
    mutationFn: (status: string) =>
      bulkUpdateStatus(Array.from(selected), status),
    onSuccess: () => {
      toast.success(`Updated status on ${selected.size} transactions`);
      invalidate();
    },
  });

  const bulkDescriptionMutation = useMutation({
    mutationFn: (description: string) =>
      bulkUpdateDescription(Array.from(selected), description),
    onSuccess: () => {
      toast.success(`Updated description on ${selected.size} transactions`);
      invalidate();
    },
  });

  const bulkDateMutation = useMutation({
    mutationFn: (date: string) =>
      bulkUpdateDate(Array.from(selected), date),
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
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Transactions</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setCsvOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Import CSV
          </Button>
          <Button onClick={() => setPdfOpen(true)}>
            <FileText className="h-4 w-4 mr-2" />
            Import statements
          </Button>
        </div>
      </div>

      <TransactionFiltersBar
        filters={filters}
        onChange={(f) => {
          setFilters(f);
          setPage(0);
        }}
        uncategorizedCount={uncatData}
      />

      <BulkActionsBar
        selectedCount={selected.size}
        onSetCategory={(cid) => bulkCategoryMutation.mutate(cid)}
        onSetAccount={(aid) => bulkAccountMutation.mutate(aid)}
        onSetStatus={(s) => bulkStatusMutation.mutate(s)}
        onSetDescription={(d) => bulkDescriptionMutation.mutate(d)}
        onSetDate={(d) => bulkDateMutation.mutate(d)}
        onDelete={() => deleteMutation.mutate()}
        onMarkNotDuplicate={() => notDuplicateMutation.mutate()}
      />

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="p-3 w-10">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleAll}
                    />
                  </th>
                  <SortableHeader field="date" sort={sort} onSort={handleSort}>Date</SortableHeader>
                  <SortableHeader field="description" sort={sort} onSort={handleSort}>Description</SortableHeader>
                  <SortableHeader field="amount" sort={sort} onSort={handleSort} align="right">Amount</SortableHeader>
                  <SortableHeader field="group" sort={sort} onSort={handleSort} className="w-[140px]">Group</SortableHeader>
                  <SortableHeader field="lineItem" sort={sort} onSort={handleSort} className="w-[180px]">Line Item</SortableHeader>
                  <SortableHeader field="account" sort={sort} onSort={handleSort}>Account</SortableHeader>
                  <SortableHeader field="status" sort={sort} onSort={handleSort} align="center">Status</SortableHeader>
                  <th className="text-center p-3 w-16">Note</th>
                  <th className="text-center p-3 w-20">Actions</th>
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
                    onNotesChange={(notes) =>
                      notesMutation.mutateAsync({ id: t.id, notes })
                    }
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
              Showing {page * pageSize + 1}-
              {Math.min((page + 1) * pageSize, totalCount)} of{" "}
              {totalCount.toLocaleString()}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
                Prev
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page + 1} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}

      <CsvImportDialog
        open={csvOpen}
        onOpenChange={setCsvOpen}
        onComplete={invalidate}
      />
      <PdfStatementImportDialog
        open={pdfOpen}
        onOpenChange={setPdfOpen}
        onComplete={invalidate}
      />
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

function TransactionRow({
  transaction: t,
  isSelected,
  onToggle,
  onCategoryChange,
  onNotesChange,
  onSplitChange,
}: {
  transaction: Transaction;
  isSelected: boolean;
  onToggle: () => void;
  onCategoryChange: (categoryId: string | null) => void;
  onNotesChange: (notes: string | null) => Promise<unknown>;
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
        <Checkbox checked={isSelected} onCheckedChange={onToggle} />
      </td>
      <td className="p-3 whitespace-nowrap">{t.date}</td>
      <td className="p-3 max-w-[250px] truncate" title={t.description ?? ""}>
        {t.description}
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
        className="p-3 max-w-[140px] truncate text-muted-foreground text-xs"
        title={groupName}
      >
        {groupName}
      </td>
      <td className="p-3">
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
      <td className="p-3 text-muted-foreground text-xs">
        {t.accounts?.name ?? "—"}
      </td>
      <td className="p-3 text-center">
        <Badge
          variant="outline"
          className={cn(
            "text-xs",
            t.status === "Confirmed"
              ? "border-emerald-200 text-emerald-700"
              : "border-yellow-200 text-yellow-700"
          )}
        >
          {t.status ?? "Unknown"}
        </Badge>
      </td>
      <td className="p-3 text-center">
        <TransactionNoteDialog transaction={t} onSave={onNotesChange} />
      </td>
      <td className="p-3 text-center">
        <div className="flex items-center justify-center gap-1">
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

function TransactionNoteDialog({
  transaction,
  onSave,
}: {
  transaction: Transaction;
  onSave: (notes: string | null) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(transaction.notes ?? "");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) setNotes(transaction.notes ?? "");
  }, [open, transaction.notes]);

  const save = async () => {
    setIsSaving(true);
    try {
      const normalizedNotes = notes.trim() || null;
      await onSave(normalizedNotes);
      setNotes(normalizedNotes ?? "");
      setOpen(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setOpen(true)}
        aria-label={transaction.notes ? "Edit transaction note" : "Add transaction note"}
        title={transaction.notes ?? "Add note"}
        className={cn(transaction.notes && "text-blue-600")}
      >
        <StickyNote className={cn("h-4 w-4", transaction.notes && "fill-current/15")} />
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transaction note</DialogTitle>
          <DialogDescription>
            Add a private note for {transaction.description || "this transaction"}.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Add details, context, or a reminder..."
          rows={5}
          maxLength={2000}
          autoFocus
        />
        <div className="text-right text-xs text-muted-foreground">
          {notes.length}/2000
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={isSaving}>
            {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
