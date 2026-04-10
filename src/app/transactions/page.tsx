"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getTransactions,
  updateTransactionCategory,
  bulkUpdateCategory,
  bulkConfirm,
  deleteTransactions,
  type TransactionFilters,
  type Transaction,
} from "@/lib/queries/transactions";
import { TransactionFiltersBar } from "@/components/transactions/transaction-filters";
import { BulkActionsBar } from "@/components/transactions/bulk-actions-bar";
import { CategorySelect } from "@/components/transactions/category-select";
import { CsvImportDialog } from "@/components/transactions/csv-import-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft,
  ChevronRight,
  Upload,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase/client";

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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [csvOpen, setCsvOpen] = useState(false);
  const pageSize = 50;

  const { data, isLoading } = useQuery({
    queryKey: ["transactions", page, filters],
    queryFn: () => getTransactions(page, pageSize, filters),
  });

  const { data: uncatData } = useQuery({
    queryKey: ["uncategorized-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("transactions")
        .select("*", { count: "exact", head: true })
        .is("category_id", null)
        .is("parent_id", null);
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
    mutationFn: ({ id, categoryId }: { id: string; categoryId: string }) =>
      updateTransactionCategory(id, categoryId),
    onSuccess: invalidate,
  });

  const bulkCategoryMutation = useMutation({
    mutationFn: (categoryId: string) =>
      bulkUpdateCategory(Array.from(selected), categoryId),
    onSuccess: () => {
      toast.success(`Updated ${selected.size} transactions`);
      invalidate();
    },
  });

  const bulkConfirmMutation = useMutation({
    mutationFn: () => bulkConfirm(Array.from(selected)),
    onSuccess: () => {
      toast.success(`Confirmed ${selected.size} transactions`);
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

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Transactions</h2>
        <Button variant="outline" onClick={() => setCsvOpen(true)}>
          <Upload className="h-4 w-4 mr-2" />
          Import CSV
        </Button>
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
        onConfirmAll={() => bulkConfirmMutation.mutate()}
        onDelete={() => deleteMutation.mutate()}
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
                  <th className="text-left p-3">Date</th>
                  <th className="text-left p-3">Description</th>
                  <th className="text-right p-3">Amount</th>
                  <th className="text-left p-3 w-[200px]">Category</th>
                  <th className="text-left p-3">Account</th>
                  <th className="text-center p-3">Status</th>
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
                  />
                ))}
                {transactions.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
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
    </div>
  );
}

function TransactionRow({
  transaction: t,
  isSelected,
  onToggle,
  onCategoryChange,
}: {
  transaction: Transaction;
  isSelected: boolean;
  onToggle: () => void;
  onCategoryChange: (categoryId: string) => void;
}) {
  const isExpense = t.amount < 0;
  const categoryLabel = t.budget_categories
    ? `${t.budget_categories.group_name} > ${t.budget_categories.line_item_name}`
    : null;

  return (
    <tr className={cn("border-t hover:bg-accent/50", isSelected && "bg-accent/30")}>
      <td className="p-3">
        <Checkbox checked={isSelected} onCheckedChange={onToggle} />
      </td>
      <td className="p-3 whitespace-nowrap">{t.date}</td>
      <td className="p-3 max-w-[250px] truncate" title={t.description ?? ""}>
        {t.description}
        {t.is_split && (
          <Badge variant="outline" className="ml-2 text-xs">
            Split
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
      <td className="p-3">
        <CategorySelect
          value={t.category_id}
          onValueChange={onCategoryChange}
          placeholder={categoryLabel ?? "Uncategorized"}
          className="h-8 text-xs"
        />
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
    </tr>
  );
}
