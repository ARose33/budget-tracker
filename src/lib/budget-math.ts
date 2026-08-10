import type { BudgetGroup } from "@/lib/queries/budget";

export interface BudgetTotals {
  budgetedIncome: number;
  budgetedExpenses: number;
  plannedNet: number;
  expenseRollover: number;
  availableExpenses: number;
  actualIncome: number;
  actualExpenses: number;
  actualNet: number;
  remainingExpenses: number;
}

export function calculateBudgetTotals(groups: BudgetGroup[]): BudgetTotals {
  const incomeGroups = groups.filter(
    (group) => group.category_type.toLowerCase() === "income"
  );
  const expenseGroups = groups.filter(
    (group) => group.category_type.toLowerCase() === "expense"
  );

  const budgetedIncome = incomeGroups.reduce(
    (sum, group) => sum + Number(group.total_budget),
    0
  );
  const budgetedExpenses = expenseGroups.reduce(
    (sum, group) => sum + Number(group.total_budget),
    0
  );
  const expenseRollover = expenseGroups.reduce(
    (sum, group) => sum + Number(group.total_rollover),
    0
  );
  const actualIncome = incomeGroups.reduce(
    (sum, group) => sum + Number(group.total_spent),
    0
  );
  const actualExpenses = expenseGroups.reduce(
    (sum, group) => sum + Number(group.total_spent),
    0
  );
  const availableExpenses = budgetedExpenses + expenseRollover;

  return {
    budgetedIncome,
    budgetedExpenses,
    plannedNet: budgetedIncome - budgetedExpenses,
    expenseRollover,
    availableExpenses,
    actualIncome,
    actualExpenses,
    actualNet: actualIncome - actualExpenses,
    remainingExpenses: availableExpenses - actualExpenses,
  };
}
