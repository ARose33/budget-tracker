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
    (group) => group.category_type.toLowerCase() === "income",
  );
  const expenseGroups = groups.filter(
    (group) => group.category_type.toLowerCase() === "expense",
  );

  const budgetedIncome = incomeGroups.reduce(
    (sum, group) => sum + Math.round(Number(group.total_budget) * 100),
    0,
  );
  const budgetedExpenses = expenseGroups.reduce(
    (sum, group) => sum + Math.round(Number(group.total_budget) * 100),
    0,
  );
  const expenseRollover = expenseGroups.reduce(
    (sum, group) => sum + Math.round(Number(group.total_rollover) * 100),
    0,
  );
  const actualIncome = incomeGroups.reduce(
    (sum, group) => sum + Math.round(Number(group.total_spent) * 100),
    0,
  );
  const actualExpenses = expenseGroups.reduce(
    (sum, group) => sum + Math.round(Number(group.total_spent) * 100),
    0,
  );
  const availableExpenses = budgetedExpenses + expenseRollover;

  return {
    budgetedIncome: budgetedIncome / 100,
    budgetedExpenses: budgetedExpenses / 100,
    plannedNet: (budgetedIncome - budgetedExpenses) / 100,
    expenseRollover: expenseRollover / 100,
    availableExpenses: availableExpenses / 100,
    actualIncome: actualIncome / 100,
    actualExpenses: actualExpenses / 100,
    actualNet: (actualIncome - actualExpenses) / 100,
    remainingExpenses: (availableExpenses - actualExpenses) / 100,
  };
}
