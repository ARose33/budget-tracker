import { supabase } from "@/lib/supabase/client";

export interface SpendingByMonth {
  year_num: number;
  month_num: number;
  group_name: string;
  total: number;
}

export interface CashFlow {
  year_num: number;
  month_num: number;
  income: number;
  expenses: number;
  net: number;
}

export async function getSpendingByMonth(
  months: number = 12
): Promise<SpendingByMonth[]> {
  const { data, error } = await supabase.rpc("get_spending_by_month", {
    p_months: months,
  });
  if (error) throw error;
  return (data as SpendingByMonth[]) ?? [];
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
