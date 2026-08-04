import { supabase } from "@/lib/supabase/client";
import { getCurrentUserId } from "@/lib/supabase/auth";

export interface SpendingByMonth {
  year_num: number;
  month_num: number;
  group_name: string;
  line_item_name: string | null;
  category_label: string;
  total: number;
}

export type SpendingGranularity = "group" | "category";

export interface CashFlow {
  year_num: number;
  month_num: number;
  income: number;
  expenses: number;
  net: number;
}

export async function getSpendingByMonth(
  months: number = 12,
  granularity: SpendingGranularity = "group"
): Promise<SpendingByMonth[]> {
  if (granularity === "category") {
    return getSpendingByCategoryMonth(months);
  }

  const { data, error } = await supabase.rpc("get_spending_by_month", {
    p_months: months,
  });
  if (error) throw error;
  return ((data as Omit<SpendingByMonth, "line_item_name" | "category_label">[]) ?? []).map(
    (row) => ({
      ...row,
      line_item_name: null,
      category_label: row.group_name,
    })
  );
}

async function getSpendingByCategoryMonth(
  months: number
): Promise<SpendingByMonth[]> {
  const userId = await getCurrentUserId();
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
  const startDate = start.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("effective_transactions")
    .select("date, amount, category_id")
    .eq("user_id", userId)
    .lt("amount", 0)
    .gte("date", startDate)

  if (error) throw error;

  const { data: categories, error: categoryError } = await supabase
    .from("budget_categories")
    .select("id, group_name, line_item_name, category_type")
    .eq("user_id", userId)
    .ilike("category_type", "expense");

  if (categoryError) throw categoryError;
  const categoriesById = new Map((categories ?? []).map((category) => [category.id, category]));

  const totals = new Map<string, SpendingByMonth>();
  for (const transaction of data ?? []) {
    const category = transaction.category_id
      ? categoriesById.get(transaction.category_id)
      : null;
    if (!category) continue;

    const date = new Date(`${transaction.date}T00:00:00`);
    const yearNum = date.getFullYear();
    const monthNum = date.getMonth() + 1;
    const categoryLabel = `${category.group_name}: ${category.line_item_name}`;
    const key = `${yearNum}-${monthNum}-${categoryLabel}`;

    if (!totals.has(key)) {
      totals.set(key, {
        year_num: yearNum,
        month_num: monthNum,
        group_name: category.group_name,
        line_item_name: category.line_item_name,
        category_label: categoryLabel,
        total: 0,
      });
    }

    totals.get(key)!.total += Math.abs(Number(transaction.amount));
  }

  return Array.from(totals.values()).sort(
    (a, b) =>
      a.year_num - b.year_num ||
      a.month_num - b.month_num ||
      a.category_label.localeCompare(b.category_label)
  );
}

export async function getCashFlow(months: number = 12): Promise<CashFlow[]> {
  const { data, error } = await supabase.rpc("get_cash_flow", {
    p_months: months,
  });
  if (error) throw error;
  return (data as CashFlow[]) ?? [];
}

export async function getYearOverYearSpending(): Promise<SpendingByMonth[]> {
  // Get all spending data (36 months covers 3 years)
  return getSpendingByMonth(36);
}
