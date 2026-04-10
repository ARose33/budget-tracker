"use client";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface BudgetSummaryCardProps {
  label: string;
  amount: number;
  subtext?: string;
  variant?: "default" | "income" | "expense" | "net";
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function BudgetSummaryCard({
  label,
  amount,
  subtext,
  variant = "default",
}: BudgetSummaryCardProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p
          className={cn(
            "text-2xl font-bold mt-1",
            variant === "income" && "text-emerald-600",
            variant === "expense" && "text-red-500",
            variant === "net" && amount >= 0 && "text-emerald-600",
            variant === "net" && amount < 0 && "text-red-500"
          )}
        >
          {formatCurrency(Math.abs(amount))}
        </p>
        {subtext && (
          <p className="text-xs text-muted-foreground mt-1">{subtext}</p>
        )}
      </CardContent>
    </Card>
  );
}
