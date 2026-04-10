"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCashFlow } from "@/lib/queries/analysis";
import {
  ComposedChart,
  Bar,
  Line,
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

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function CashFlowPage() {
  const [months, setMonths] = useState("12");

  const { data: raw = [], isLoading } = useQuery({
    queryKey: ["cash-flow", months],
    queryFn: () => getCashFlow(Number(months)),
  });

  const chartData = raw.map((r) => ({
    month: format(new Date(r.year_num, r.month_num - 1), "MMM yy"),
    Income: Number(r.income),
    Expenses: Number(r.expenses),
    Net: Number(r.net),
  }));

  const avgIncome =
    chartData.length > 0
      ? chartData.reduce((s, d) => s + d.Income, 0) / chartData.length
      : 0;
  const avgExpenses =
    chartData.length > 0
      ? chartData.reduce((s, d) => s + d.Expenses, 0) / chartData.length
      : 0;
  const savingsRate = avgIncome > 0 ? ((avgIncome - avgExpenses) / avgIncome) * 100 : 0;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Cash Flow</h2>
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

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Avg Monthly Income</p>
            <p className="text-2xl font-bold text-emerald-600">
              {formatCurrency(avgIncome)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              Avg Monthly Expenses
            </p>
            <p className="text-2xl font-bold text-red-500">
              {formatCurrency(avgExpenses)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Savings Rate</p>
            <p className="text-2xl font-bold">{savingsRate.toFixed(0)}%</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Income vs Expenses</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center h-[400px]">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={400}>
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  tick={{ fontSize: 12 }}
                />
                <Tooltip
                  formatter={(value) => formatCurrency(Number(value))}
                />
                <Legend />
                <Bar dataKey="Income" fill="#10b981" />
                <Bar dataKey="Expenses" fill="#ef4444" />
                <Line
                  type="monotone"
                  dataKey="Net"
                  stroke="#f97316"
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
