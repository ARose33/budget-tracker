import assert from "node:assert/strict";
import test from "node:test";

import { calculateBudgetTotals } from "./budget-math.ts";
import type { BudgetGroup } from "./queries/budget.ts";

function group(
  categoryType: "Income" | "Expense",
  budget: number,
  spent: number,
  rollover: number
): BudgetGroup {
  return {
    group_name: categoryType,
    category_type: categoryType,
    items: [],
    total_budget: budget,
    total_spent: spent,
    total_rollover: rollover,
    total_effective: budget + rollover,
  };
}

test("separates monthly targets, expense rollover, and actual activity", () => {
  const totals = calculateBudgetTotals([
    group("Income", 5_000, 4_800, 0),
    group("Expense", 3_500, 2_900, 600),
    group("Expense", 500, 250, -100),
  ]);

  assert.deepEqual(totals, {
    budgetedIncome: 5_000,
    budgetedExpenses: 4_000,
    plannedNet: 1_000,
    expenseRollover: 500,
    availableExpenses: 4_500,
    actualIncome: 4_800,
    actualExpenses: 3_150,
    actualNet: 1_650,
    remainingExpenses: 1_350,
  });
});

test("does not treat income rollover as spendable expense money", () => {
  const totals = calculateBudgetTotals([
    group("Income", 3_000, 3_000, 9_000),
    group("Expense", 2_000, 0, 250),
  ]);

  assert.equal(totals.expenseRollover, 250);
  assert.equal(totals.availableExpenses, 2_250);
});
