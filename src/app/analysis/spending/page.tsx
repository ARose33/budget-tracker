"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSpendingByMonth } from "@/lib/queries/analysis";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { format } from "date-fns";

const COLORS = [
  "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4",
  "#ec4899", "#f97316", "#14b8a6", "#6366f1", "#84cc16",
];

export default function SpendingPage() {
  const [months, setMonths] = useState("12");

  const { data: raw = [], isLoading } = useQuery({
    queryKey: ["spending-by-month", months],
    queryFn: () => getSpendingByMonth(Number(months)),
  });

  // Get unique groups
  const groups = [...new Set(raw.map((r) => r.group_name))].sort();

  // Pivot data: one row per month, one key per group
  const chartData = Object.values(
    raw.reduce(
      (acc, r) => {
        const key = `${r.year_num}-${String(r.month_num).padStart(2, "0")}`;
        if (!acc[key]) {
          acc[key] = { month: format(new Date(r.year_num, r.month_num - 1), "MMM yy") };
        }
        acc[key][r.group_name] = Number(r.total);
        return acc;
      },
      {} as Record<string, Record<string, string | number>>
    )
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Spending Trends</h2>
        <Select value={months} onValueChange={(v) => v && setMonths(v)}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="6">Last 6 months</SelectItem>
            <SelectItem value="12">Last 12 months</SelectItem>
            <SelectItem value="24">Last 24 months</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Monthly Spending by Category</CardTitle>
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
                <Tooltip
                  formatter={(value) =>
                    `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                  }
                />
                <Legend />
                {groups.map((group, i) => (
                  <Bar
                    key={group}
                    dataKey={group}
                    stackId="a"
                    fill={COLORS[i % COLORS.length]}
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
