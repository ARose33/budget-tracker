"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MonthPicker } from "@/components/layout/month-picker";
import { BudgetSummaryCard } from "@/components/budget/budget-summary-card";
import { BudgetGroupCard } from "@/components/budget/budget-group";
import {
  BudgetEditDialog,
  type BudgetDialogMode,
  type BudgetFormValues,
} from "@/components/budget/budget-edit-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  createBudgetCategory,
  getBudgetWithRollover,
  getMonthlyUncategorizedSummary,
  groupBudgetItems,
  ensureBudgetRows,
  renameBudgetGroup,
  updateBudgetLineItem,
  type BudgetCategoryType,
} from "@/lib/queries/budget";
import { createTransactionsHref } from "@/lib/transaction-filter-params";
import { calculateBudgetTotals } from "@/lib/budget-math";
import { useMonthSelector } from "@/hooks/use-month-selector";
import { ChevronRight, CircleHelp, Loader2, Plus } from "lucide-react";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function getMonthDateRange(year: number, month: number) {
  const pad = (value: number) => String(value).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  const monthPrefix = `${year}-${pad(month)}`;

  return {
    dateFrom: `${monthPrefix}-01`,
    dateTo: `${monthPrefix}-${pad(lastDay)}`,
  };
}

function getCategoryType(value: string): BudgetCategoryType {
  return value.toLowerCase() === "income" ? "Income" : "Expense";
}

function getDialogKey(mode: BudgetDialogMode | null) {
  if (!mode) return "closed";
  if (mode.type === "add-group") return `add-group-${mode.categoryType}`;
  if (mode.type === "add-item") return `add-item-${mode.group.group_name}`;
  if (mode.type === "edit-group") return `edit-group-${mode.group.group_name}`;
  return `edit-item-${mode.item.category_id}`;
}

function BudgetContent() {
  const { year, month } = useMonthSelector();
  const queryClient = useQueryClient();
  const [dialogMode, setDialogMode] = useState<BudgetDialogMode | null>(null);
  const dialogOpen = dialogMode !== null;

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["budget", year, month],
    queryFn: async () => {
      await ensureBudgetRows(year, month);
      return getBudgetWithRollover(year, month);
    },
  });

  const {
    data: uncategorized = { count: 0, total: 0 },
    isLoading: isUncategorizedLoading,
    isError: isUncategorizedError,
  } = useQuery({
    queryKey: ["budget-uncategorized", year, month],
    queryFn: () => getMonthlyUncategorizedSummary(year, month),
  });

  const monthDateRange = getMonthDateRange(year, month);
  const incomeTransactionsHref = createTransactionsHref({
    ...monthDateRange,
    categoryType: "Income",
  });
  const expenseTransactionsHref = createTransactionsHref({
    ...monthDateRange,
    categoryType: "Expense",
  });
  const uncategorizedTransactionsHref = createTransactionsHref({
    ...monthDateRange,
    uncategorizedOnly: true,
  });

  const groups = groupBudgetItems(items);
  const expenseGroups = groups.filter(
    (g) => g.category_type === "Expense" || g.category_type === "expense"
  );
  const incomeGroups = groups.filter(
    (g) => g.category_type === "Income" || g.category_type === "income"
  );

  const totals = calculateBudgetTotals(groups);

  const saveMutation = useMutation({
    mutationFn: ({
      mode,
      values,
    }: {
      mode: BudgetDialogMode;
      values: BudgetFormValues;
    }) => {
      if (mode.type === "add-group") {
        return createBudgetCategory({
          groupName: values.groupName,
          lineItemName: values.lineItemName,
          categoryType: mode.categoryType,
          year,
          month,
          budgetLimit: values.budgetLimit,
        });
      }

      if (mode.type === "add-item") {
        return createBudgetCategory({
          groupName: mode.group.group_name,
          lineItemName: values.lineItemName,
          categoryType: getCategoryType(mode.group.category_type),
          year,
          month,
          budgetLimit: values.budgetLimit,
        });
      }

      if (mode.type === "edit-group") {
        return renameBudgetGroup({
          currentGroupName: mode.group.group_name,
          categoryType: mode.group.category_type,
          newGroupName: values.groupName,
        });
      }

      return updateBudgetLineItem({
        categoryId: mode.item.category_id,
        groupName: mode.item.group_name,
        categoryType: mode.item.category_type,
        lineItemName: values.lineItemName,
        year,
        month,
        budgetLimit: values.budgetLimit,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budget"] });
      setDialogMode(null);
      toast.success("Budget updated");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to update budget"
      );
    },
  });

  const handleEdit = (categoryId: string) => {
    const item = items.find((i) => i.category_id === categoryId);
    if (item) {
      setDialogMode({ type: "edit-item", item });
    }
  };

  const handleSave = (values: BudgetFormValues) => {
    if (!dialogMode) return;
    saveMutation.mutate({ mode: dialogMode, values });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Monthly Budget</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Set your plan, then track this month against it.
          </p>
        </div>
        <MonthPicker />
      </div>

      <Tabs defaultValue="plan">
        <TabsList aria-label="Budget views">
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="plan" className="space-y-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <BudgetSummaryCard
              label="Budgeted income"
              amount={totals.budgetedIncome}
              variant="income"
              subtext="Monthly target"
            />
            <BudgetSummaryCard
              label="Budgeted expenses"
              amount={totals.budgetedExpenses}
              variant="expense"
              subtext="Monthly target"
            />
            <BudgetSummaryCard
              label="Expense rollover"
              amount={totals.expenseRollover}
              variant="rollover"
              subtext="From earlier months"
            />
            <BudgetSummaryCard
              label="Available for expenses"
              amount={totals.availableExpenses}
              variant="available"
              subtext="Budget + rollover"
            />
          </div>

          <Card size="sm">
            <CardContent className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
              <div>
                <p className="font-medium">Planned cash flow</p>
                <p className="text-xs text-muted-foreground">
                  Budgeted income minus budgeted expenses; rollover is excluded.
                </p>
              </div>
              <p
                className={`text-xl font-bold tabular-nums ${
                  totals.plannedNet >= 0 ? "text-emerald-700" : "text-red-600"
                }`}
              >
                {formatCurrency(totals.plannedNet)}
              </p>
            </CardContent>
          </Card>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-emerald-700">Income plan</h3>
            <p className="text-xs text-muted-foreground">What you expect to receive this month</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setDialogMode({ type: "add-group", categoryType: "Income" })
            }
          >
            <Plus />
            Add income category
          </Button>
        </div>
        {incomeGroups.length > 0 ? (
          incomeGroups.map((group) => (
            <BudgetGroupCard
              key={group.group_name}
              group={group}
              view="plan"
              transactionsHref={createTransactionsHref({
                ...monthDateRange,
                categoryType: "Income",
                categoryGroup: group.group_name,
              })}
              getItemTransactionsHref={(categoryId) =>
                createTransactionsHref({
                  ...monthDateRange,
                  categoryType: "Income",
                  categoryId,
                })
              }
              onEditItem={handleEdit}
              onAddItem={(selectedGroup) =>
                setDialogMode({ type: "add-item", group: selectedGroup })
              }
              onEditGroup={(selectedGroup) =>
                setDialogMode({ type: "edit-group", group: selectedGroup })
              }
            />
          ))
        ) : (
          <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
            No income categories yet.
          </p>
        )}
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-red-600">Expense plan</h3>
            <p className="text-xs text-muted-foreground">What you intend to spend this month</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setDialogMode({ type: "add-group", categoryType: "Expense" })
            }
          >
            <Plus />
            Add expense category
          </Button>
        </div>
        {expenseGroups.length > 0 ? (
          expenseGroups.map((group) => (
            <BudgetGroupCard
              key={group.group_name}
              group={group}
              view="plan"
              transactionsHref={createTransactionsHref({
                ...monthDateRange,
                categoryType: "Expense",
                categoryGroup: group.group_name,
              })}
              getItemTransactionsHref={(categoryId) =>
                createTransactionsHref({
                  ...monthDateRange,
                  categoryType: "Expense",
                  categoryId,
                })
              }
              onEditItem={handleEdit}
              onAddItem={(selectedGroup) =>
                setDialogMode({ type: "add-item", group: selectedGroup })
              }
              onEditGroup={(selectedGroup) =>
                setDialogMode({ type: "edit-group", group: selectedGroup })
              }
            />
          ))
        ) : (
          <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
            No expense categories yet.
          </p>
        )}
      </div>

        </TabsContent>

        <TabsContent value="activity" className="space-y-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <BudgetSummaryCard
              label="Income received"
              amount={totals.actualIncome}
              variant="income"
              href={incomeTransactionsHref}
              subtext="This month"
            />
            <BudgetSummaryCard
              label="Expenses spent"
              amount={totals.actualExpenses}
              variant="expense"
              href={expenseTransactionsHref}
              subtext="This month"
            />
            <BudgetSummaryCard
              label="Actual cash flow"
              amount={totals.actualNet}
              variant="net"
              subtext="Income minus expenses"
            />
            <BudgetSummaryCard
              label="Expense budget left"
              amount={totals.remainingExpenses}
              variant="net"
              subtext="Available minus spent"
            />
          </div>

          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-emerald-700">Income activity</h3>
            {incomeGroups.length > 0 ? (
              incomeGroups.map((group) => (
                <BudgetGroupCard
                  key={group.group_name}
                  group={group}
                  view="activity"
                  transactionsHref={createTransactionsHref({
                    ...monthDateRange,
                    categoryType: "Income",
                    categoryGroup: group.group_name,
                  })}
                  getItemTransactionsHref={(categoryId) =>
                    createTransactionsHref({
                      ...monthDateRange,
                      categoryType: "Income",
                      categoryId,
                    })
                  }
                />
              ))
            ) : (
              <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
                No income categories yet.
              </p>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-red-600">Expense activity</h3>
            {expenseGroups.length > 0 ? (
              expenseGroups.map((group) => (
                <BudgetGroupCard
                  key={group.group_name}
                  group={group}
                  view="activity"
                  transactionsHref={createTransactionsHref({
                    ...monthDateRange,
                    categoryType: "Expense",
                    categoryGroup: group.group_name,
                  })}
                  getItemTransactionsHref={(categoryId) =>
                    createTransactionsHref({
                      ...monthDateRange,
                      categoryType: "Expense",
                      categoryId,
                    })
                  }
                />
              ))
            ) : (
              <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
                No expense categories yet.
              </p>
            )}
          </div>

      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-amber-700">Needs attention</h3>
        <Link
          href={uncategorizedTransactionsHref}
          aria-label="View uncategorized transactions"
          className="flex items-center justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3 transition-colors hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
              <CircleHelp className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-amber-950">Uncategorized</p>
              <p className="text-sm text-amber-800/80">
                {isUncategorizedLoading
                  ? "Checking this month…"
                  : isUncategorizedError
                    ? "Could not load this month’s summary"
                  : `${uncategorized.count.toLocaleString()} ${
                      uncategorized.count === 1 ? "transaction needs" : "transactions need"
                    } categorization`}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-amber-950">
            {isUncategorizedLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isUncategorizedError ? (
              <span className="text-sm text-amber-800">Unavailable</span>
            ) : (
              <span className="font-semibold tabular-nums">
                {formatCurrency(uncategorized.total)}
              </span>
            )}
            <ChevronRight className="h-4 w-4" />
          </div>
        </Link>
      </div>
        </TabsContent>
      </Tabs>

      <BudgetEditDialog
        key={getDialogKey(dialogMode)}
        mode={dialogMode}
        open={dialogOpen}
        isSaving={saveMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setDialogMode(null);
        }}
        onSave={handleSave}
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
