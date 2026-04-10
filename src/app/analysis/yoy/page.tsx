"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getYearOverYearSpending } from "@/lib/queries/analysis";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const YEAR_COLORS: Record<number, string> = {
  2024: "#8b5cf6",
  2025: "#06b6d4",
  2026: "#10b981",
};

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function YearOverYearPage() {
  const { data: raw = [], isLoading } = useQuery({
    queryKey: ["yoy-spending"],
    queryFn: getYearOverYearSpending,
  });

  const { chartData, years } = useMemo(() => {
    // Sum all spending per year+month
    const yearMonthTotals = new Map<string, number>();
    const yearsSet = new Set<number>();

    for (const r of raw) {
      const key = `${r.year_num}-${r.month_num}`;
      yearMonthTotals.set(key, (yearMonthTotals.get(key) ?? 0) + Number(r.total));
      yearsSet.add(r.year_num);
    }

    const years = [...yearsSet].sort();
    const data = MONTH_LABELS.map((label, i) => {
      const row: Record<string, string | number> = { month: label };
      for (const year of years) {
        row[String(year)] = yearMonthTotals.get(`${year}-${i + 1}`) ?? 0;
      }
      return row;
    });

    return { chartData: data, years };
  }, [raw]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold">Year over Year Comparison</h2>

      <Card>
        <CardHeader>
          <CardTitle>Monthly Spending by Year</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center h-[400px]">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  tick={{ fontSize: 12 }}
                />
                <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                <Legend />
                {years.map((year) => (
                  <Bar
                    key={year}
                    dataKey={String(year)}
                    fill={YEAR_COLORS[year] ?? "#94a3b8"}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
