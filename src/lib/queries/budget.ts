import { supabase } from "@/lib/supabase/client";

export interface BudgetLineItem {
  category_id: string;
  group_name: string;
  line_item_name: string;
  category_type: string;
  budget_limit: number;
  actual_spent: number;
  rollover: number;
  effective_budget: number;
}

export interface BudgetGroup {
  group_name: string;
  category_type: string;
  items: BudgetLineItem[];
  total_budget: number;
  total_spent: number;
  total_rollover: number;
  total_effective: number;
}

export async function getBudgetWithRollover(
  year: number,
  month: number
): Promise<BudgetLineItem[]> {
  const { data, error } = await supabase.rpc("get_budget_with_rollover", {
    p_year: year,
    p_month: month,
  });

  if (error) throw error;
  return (data as BudgetLineItem[]) ?? [];
}

export function groupBudgetItems(items: BudgetLineItem[]): BudgetGroup[] {
  const groups = new Map<string, BudgetGroup>();

  for (const item of items) {
    const key = item.group_name;
    if (!groups.has(key)) {
      groups.set(key, {
        group_name: key,
        category_type: item.category_type,
        items: [],
        total_budget: 0,
        total_spent: 0,
        total_rollover: 0,
        total_effective: 0,
      });
    }
    const group = groups.get(key)!;
    group.items.push(item);
    group.total_budget += Number(item.budget_limit);
    group.total_spent += Number(item.actual_spent);
    group.total_rollover += Number(item.rollover);
    group.total_effective += Number(item.effective_budget);
  }

  return Array.from(groups.values()).sort((a, b) =>
    a.group_name.localeCompare(b.group_name)
  );
}

export async function ensureBudgetRows(year: number, month: number) {
  // Check if budget rows exist for this month
  const { count } = await supabase
    .from("budgets")
    .select("*", { count: "exact", head: true })
    .eq("year_number", year)
    .eq("month_number", month);

  if (count && count > 0) return;

  // Find the latest month with budget data
  const { data: latest } = await supabase
    .from("budgets")
    .select("year_number, month_number")
    .order("year_number", { ascending: false })
    .order("month_number", { ascending: false })
    .limit(1);

  if (!latest || latest.length === 0) return;

  const lastYear = latest[0].year_number;
  const lastMonth = latest[0].month_number;

  // Copy budget rows from the latest month
  const { data: templates } = await supabase
    .from("budgets")
    .select("category_id, budget_limit")
    .eq("year_number", lastYear)
    .eq("month_number", lastMonth);

  if (!templates || templates.length === 0) return;

  const newRows = templates.map((t) => ({
    category_id: t.category_id,
    year_number: year,
    month_number: month,
    budget_limit: t.budget_limit,
  }));

  await supabase.from("budgets").insert(newRows);
}

export async function updateBudgetLimit(
  categoryId: string,
  year: number,
  month: number,
  newLimit: number
) {
  const { error } = await supabase
    .from("budgets")
    .update({ budget_limit: newLimit })
    .eq("category_id", categoryId)
    .eq("year_number", year)
    .eq("month_number", month);

  if (error) throw error;
}
