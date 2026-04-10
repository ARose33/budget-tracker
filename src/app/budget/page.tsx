"use client";

import { Suspense, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MonthPicker } from "@/components/layout/month-picker";
import { BudgetSummaryCard } from "@/components/budget/budget-summary-card";
import { BudgetGroupCard } from "@/components/budget/budget-group";
import { BudgetEditDialog } from "@/components/budget/budget-edit-dialog";
import {
  getBudgetWithRollover,
  groupBudgetItems,
  ensureBudgetRows,
  updateBudgetLimit,
  type BudgetLineItem,
} from "@/lib/queries/budget";
import { useMonthSelector } from "@/hooks/use-month-selector";
import { Loader2 } from "lucide-react";

function BudgetContent() {
  const { year, month } = useMonthSelector();
  const queryClient = useQueryClient();
  const [editItem, setEditItem] = useState<BudgetLineItem | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["budget", year, month],
    queryFn: async () => {
      await ensureBudgetRows(year, month);
      return getBudgetWithRollover(year, month);
    },
  });

  const groups = groupBudgetItems(items);
  const expenseGroups = groups.filter(
    (g) => g.category_type === "Expense" || g.category_type === "expense"
  );
  const incomeGroups = groups.filter(
    (g) => g.category_type === "Income" || g.category_type === "income"
  );

  const totalIncome = incomeGroups.reduce((s, g) => s + g.total_spent, 0);
  const totalExpenses = expenseGroups.reduce((s, g) => s + g.total_spent, 0);
  const totalBudgeted = expenseGroups.reduce((s, g) => s + g.total_effective, 0);
  const net = totalIncome - totalExpenses;

  const saveMutation = useMutation({
    mutationFn: ({
      categoryId,
      newLimit,
    }: {
      categoryId: string;
      newLimit: number;
    }) => updateBudgetLimit(categoryId, year, month, newLimit),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budget", year, month] });
      toast.success("Budget updated");
    },
    onError: () => {
      toast.error("Failed to update budget");
    },
  });

  const handleEdit = useCallback(
    (categoryId: string) => {
      const item = items.find((i) => i.category_id === categoryId);
      if (item) {
        setEditItem(item);
        setEditOpen(true);
      }
    },
    [items]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Monthly Budget</h2>
        <MonthPicker />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <BudgetSummaryCard
          label="Income"
          amount={totalIncome}
          variant="income"
        />
        <BudgetSummaryCard
          label="Expenses"
          amount={totalExpenses}
          variant="expense"
        />
        <BudgetSummaryCard
          label="Budgeted"
          amount={totalBudgeted}
        />
        <BudgetSummaryCard
          label="Net"
          amount={net}
          variant="net"
          subtext={
            totalIncome > 0
              ? `${((net / totalIncome) * 100).toFixed(0)}% savings rate`
              : undefined
          }
        />
      </div>

      {incomeGroups.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-emerald-700">Income</h3>
          {incomeGroups.map((group) => (
            <BudgetGroupCard
              key={group.group_name}
              group={group}
              onEditItem={handleEdit}
            />
          ))}
        </div>
      )}

      {expenseGroups.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-red-600">Expenses</h3>
          {expenseGroups.map((group) => (
            <BudgetGroupCard
              key={group.group_name}
              group={group}
              onEditItem={handleEdit}
            />
          ))}
        </div>
      )}

      <BudgetEditDialog
        item={editItem}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSave={(categoryId, newLimit) =>
          saveMutation.mutate({ categoryId, newLimit })
        }
      />
    </div>
  );
}

export default function BudgetPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <BudgetContent />
    </Suspense>
  );
}
