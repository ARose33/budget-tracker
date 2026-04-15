"use client";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Wallet, Target } from "lucide-react";

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

const variantStyles = {
  income: {
    ring: "ring-emerald-200",
    iconBg: "bg-emerald-100",
    iconColor: "text-emerald-600",
    accent: "from-emerald-50 to-transparent",
    amount: "text-emerald-700",
    icon: TrendingUp,
  },
  expense: {
    ring: "ring-red-200",
    iconBg: "bg-red-100",
    iconColor: "text-red-600",
    accent: "from-red-50 to-transparent",
    amount: "text-red-600",
    icon: TrendingDown,
  },
  net: {
    ring: "ring-blue-200",
    iconBg: "bg-blue-100",
    iconColor: "text-blue-600",
    accent: "from-blue-50 to-transparent",
    amount: "",
    icon: Wallet,
  },
  default: {
    ring: "ring-slate-200",
    iconBg: "bg-slate-100",
    iconColor: "text-slate-600",
    accent: "from-slate-50 to-transparent",
    amount: "text-slate-800",
    icon: Target,
  },
};

export function BudgetSummaryCard({
  label,
  amount,
  subtext,
  variant = "default",
}: BudgetSummaryCardProps) {
  const styles = variantStyles[variant];
  const Icon = styles.icon;

  const amountColor =
    variant === "net"
      ? amount >= 0
        ? "text-emerald-700"
        : "text-red-600"
      : styles.amount;

  return (
    <Card className="relative overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      <div
        className={cn(
          "absolute inset-0 bg-gradient-to-br opacity-60 pointer-events-none",
          styles.accent
        )}
      />
      <CardContent className="pt-6 relative">
        <div className="flex items-start justify-between">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <div
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg",
              styles.iconBg
            )}
          >
            <Icon className={cn("h-4 w-4", styles.iconColor)} />
          </div>
        </div>
        <p
          className={cn(
            "text-3xl font-bold tracking-tight mt-2 tabular-nums",
            amountColor
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
