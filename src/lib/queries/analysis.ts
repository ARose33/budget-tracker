import { supabase } from "@/lib/supabase/client";
import { analysisSchema } from "@/lib/finance/contracts";
import { monthKey } from "@/lib/finance/format";
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
function period(months: number) {
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const start = new Date(end.getFullYear(), end.getMonth() - months, 1);
  return {
    from: monthKey(start.getFullYear(), start.getMonth() + 1) + "-01",
    to: monthKey(end.getFullYear(), end.getMonth() + 1) + "-01",
    start,
  };
}
async function read(months: number) {
  const dates = period(months);
  const { data, error } = await supabase.rpc("stackmint_analysis", {
    p_from: dates.from,
    p_to: dates.to,
  });
  if (error) throw error;
  return analysisSchema.parse(data);
}
export async function getSpendingByMonth(
  months = 12,
  granularity: SpendingGranularity = "group",
): Promise<SpendingByMonth[]> {
  const data = await read(months);
  if (granularity === "category")
    return data.categories
      .filter((row) => row.category_type === "expense")
      .map((row) => ({
        ...row,
        category_label: row.group_name + ": " + row.line_item_name,
      }));
  return data.groups.map((row) => ({
    ...row,
    line_item_name: null,
    category_label: row.group_name,
  }));
}
export async function getCashFlow(months = 12): Promise<CashFlow[]> {
  const data = await read(months);
  const { start } = period(months);
  return Array.from({ length: months }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth() + index, 1);
    const year_num = date.getFullYear(),
      month_num = date.getMonth() + 1;
    return (
      data.flow.find(
        (row) => row.year_num === year_num && row.month_num === month_num,
      ) ?? { year_num, month_num, income: 0, expenses: 0, net: 0 }
    );
  });
}
export async function getYearOverYearSpending(): Promise<SpendingByMonth[]> {
  const months = new Date().getMonth() + 1 + 24;
  return getSpendingByMonth(months);
}
