"use client";

import { format } from "date-fns";
import { AlertTriangle, CalendarDays, Gauge, Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { BudgetGroup } from "@/lib/queries/budget";

interface MonthlyRemainingPanelProps {
  expenseGroups: BudgetGroup[];
  year: number;
  month: number;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.abs(amount));
}

function getDaysLeftInMonth(year: number, month: number) {
  const today = new Date();
  const todayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);

  if (monthEnd < todayStart) return 0;
  if (monthStart > todayStart) return monthEnd.getDate();

  return monthEnd.getDate() - todayStart.getDate() + 1;
}

function getRiskGroups(expenseGroups: BudgetGroup[]) {
  return expenseGroups
    .map((group) => {
      const spent = Number(group.total_spent);
      const effective = Number(group.total_effective);
      const remaining = effective - spent;
      const percentage = effective > 0 ? (spent / effective) * 100 : 0;

      return {
        group,
        remaining,
        percentage,
      };
    })
    .filter((item) => item.remaining < 0 || item.percentage >= 80)
    .sort((a, b) => {
      if (a.remaining < 0 && b.remaining >= 0) return -1;
      if (a.remaining >= 0 && b.remaining < 0) return 1;
      if (a.remaining < 0 && b.remaining < 0) return a.remaining - b.remaining;
      return b.percentage - a.percentage;
    })
    .slice(0, 3);
}

export function MonthlyRemainingPanel({
  expenseGroups,
  year,
  month,
}: MonthlyRemainingPanelProps) {
  const totalSpent = expenseGroups.reduce(
    (sum, group) => sum + Number(group.total_spent),
    0
  );
  const totalBudgeted = expenseGroups.reduce(
    (sum, group) => sum + Number(group.total_effective),
    0
  );
  const remaining = totalBudgeted - totalSpent;
  const daysLeft = getDaysLeftInMonth(year, month);
  const dailyPace = daysLeft > 0 ? remaining / daysLeft : 0;
  const spentPercentage =
    totalBudgeted > 0 ? Math.min((totalSpent / totalBudgeted) * 100, 100) : 0;
  const riskGroups = getRiskGroups(expenseGroups);
  const isOverBudget = remaining < 0;

  return (
    <Card className="overflow-hidden border-primary/20 bg-card shadow-sm">
      <CardContent className="space-y-5 pt-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Wallet className="h-4 w-4 text-primary" />
              Remaining this month
            </div>
            <div
              className={cn(
                "text-4xl font-bold tracking-tight tabular-nums sm:text-5xl",
                isOverBudget ? "text-red-600" : "text-emerald-700"
              )}
            >
              {isOverBudget ? "-" : ""}
              {formatCurrency(remaining)}
            </div>
            <p className="text-sm text-muted-foreground">
              {format(new Date(year, month - 1, 1), "MMMM yyyy")}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:min-w-72">
            <div className="rounded-lg border bg-background px-3 py-2">
              <p className="text-xs text-muted-foreground">Spent</p>
              <p className="text-lg font-semibold tabular-nums">
                {formatCurrency(totalSpent)}
              </p>
            </div>
            <div className="rounded-lg border bg-background px-3 py-2">
              <p className="text-xs text-muted-foreground">Budget</p>
              <p className="text-lg font-semibold tabular-nums">
                {formatCurrency(totalBudgeted)}
              </p>
            </div>
            <div className="rounded-lg border bg-background px-3 py-2">
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <CalendarDays className="h-3 w-3" />
                Days left
              </p>
              <p className="text-lg font-semibold tabular-nums">{daysLeft}</p>
            </div>
            <div className="rounded-lg border bg-background px-3 py-2">
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Gauge className="h-3 w-3" />
                Daily pace
              </p>
              <p
                className={cn(
                  "text-lg font-semibold tabular-nums",
                  dailyPace < 0 && "text-red-600"
                )}
              >
                {daysLeft > 0
                  ? `${dailyPace < 0 ? "-" : ""}${formatCurrency(dailyPace)}/day`
                  : "$0"}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Monthly spending</span>
            <span className="font-medium tabular-nums">
              {totalBudgeted > 0 ? Math.round(spentPercentage) : 0}%
            </span>
          </div>
          <Progress
            value={spentPercentage}
            className={cn(
              "h-2.5",
              isOverBudget
                ? "[&>div]:bg-red-500"
                : spentPercentage >= 80
                  ? "[&>div]:bg-yellow-500"
                  : "[&>div]:bg-emerald-500"
            )}
          />
        </div>

        {totalBudgeted <= 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
            No expense budget is set for this month yet.
          </p>
        ) : riskGroups.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
              Watch list
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              {riskGroups.map(({ group, remaining: groupRemaining, percentage }) => (
                <div
                  key={`${group.category_type}-${group.group_name}`}
                  className="rounded-lg border bg-background px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-medium">
                      {group.group_name}
                    </p>
                    <span
                      className={cn(
                        "shrink-0 text-xs font-semibold tabular-nums",
                        groupRemaining < 0 ? "text-red-600" : "text-yellow-700"
                      )}
                    >
                      {groupRemaining < 0
                        ? `${formatCurrency(groupRemaining)} over`
                        : `${Math.round(percentage)}%`}
                    </span>
                  </div>
                  <Progress
                    value={Math.min(percentage, 100)}
                    className={cn(
                      "mt-2 h-1.5",
                      groupRemaining < 0
                        ? "[&>div]:bg-red-500"
                        : "[&>div]:bg-yellow-500"
                    )}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            No budget groups are currently over pace.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
