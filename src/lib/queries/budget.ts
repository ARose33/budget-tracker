import { supabase } from "@/lib/supabase/client";
import {
  budgetSchema,
  activitySchema,
  type ActivityFilter,
} from "@/lib/finance/contracts";
import { sumMoney } from "@/lib/finance/format";
import type { BudgetLineItem } from "@/lib/finance/contracts";
export type { BudgetLineItem } from "@/lib/finance/contracts";
export type BudgetCategoryType = "Income" | "Expense";
export interface BudgetGroup {
  group_name: string;
  category_type: string;
  items: BudgetLineItem[];
  total_budget: number;
  total_spent: number;
  total_rollover: number;
  total_effective: number;
}
export async function getBudgetWorkspace(year: number, month: number) {
  const { data, error } = await supabase.rpc("stackmint_budget", {
    p_year: year,
    p_month: month,
  });
  if (error) throw error;
  return budgetSchema.parse(data);
}
export async function getBudgetActivity(
  year: number,
  month: number,
  categoryId: string | undefined,
  filter: ActivityFilter,
  page = 0,
) {
  const { data, error } = await supabase.rpc("stackmint_budget_activity", {
    p_year: year,
    p_month: month,
    p_category_id: categoryId,
    p_filter: filter,
    p_offset: page * 50,
    p_limit: 50,
  });
  if (error) throw error;
  return activitySchema.parse(data);
}
export interface BudgetEdit {
  category_id: string;
  year: number;
  month: number;
  budget_limit: number;
  expected_version: number | null;
}
export async function saveBudgets(edits: BudgetEdit[]) {
  const { error } = await supabase.rpc("stackmint_save_budgets", {
    p_edits: edits.map((edit) => ({ ...edit })),
  });
  if (error) throw error;
}
export async function saveCategory(command: {
  action: "create" | "rename" | "rename_group";
  id: string;
  group_name: string;
  line_item_name: string;
  category_type: string;
  expected_group?: string;
  expected_item?: string;
  year?: number;
  month?: number;
  budget_limit?: number;
}) {
  const { data, error } = await supabase.rpc("stackmint_category", {
    p_command: { ...command },
  });
  if (error) throw error;
  return data;
}
export function groupBudgetItems(items: BudgetLineItem[]): BudgetGroup[] {
  const groups = new Map<string, BudgetLineItem[]>();
  for (const item of items) {
    const key = item.category_type.toLowerCase() + "::" + item.group_name;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return Array.from(groups.values())
    .map((items) => ({
      group_name: items[0].group_name,
      category_type: items[0].category_type,
      items: items.toSorted((a, b) =>
        a.line_item_name.localeCompare(b.line_item_name),
      ),
      total_budget: sumMoney(items.map((item) => item.budget_limit)),
      total_spent: sumMoney(items.map((item) => item.actual_spent)),
      total_rollover: sumMoney(items.map((item) => item.rollover)),
      total_effective: sumMoney(items.map((item) => item.effective_budget)),
    }))
    .sort((a, b) => a.group_name.localeCompare(b.group_name));
}
