"use client";

import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { BudgetLineItem } from "@/lib/queries/budget";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

interface BudgetLineItemRowProps {
  item: BudgetLineItem;
  onClick?: () => void;
}

export function BudgetLineItemRow({ item, onClick }: BudgetLineItemRowProps) {
  const spent = Number(item.actual_spent);
  const effective = Number(item.effective_budget);
  const rollover = Number(item.rollover);
  const budget = Number(item.budget_limit);

  const percentage = effective > 0 ? (spent / effective) * 100 : spent > 0 ? 100 : 0;
  const remaining = effective - spent;

  return (
    <div
      className="flex items-center gap-4 py-2 px-3 rounded-md hover:bg-accent/50 cursor-pointer transition-colors"
      onClick={onClick}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium truncate">
            {item.line_item_name}
          </span>
          <div className="flex items-center gap-2 ml-2 shrink-0">
            {rollover !== 0 && (
              <Badge
                variant="outline"
                className={cn(
                  "text-xs",
                  rollover > 0
                    ? "border-emerald-200 text-emerald-700 bg-emerald-50"
                    : "border-red-200 text-red-700 bg-red-50"
                )}
              >
                {rollover > 0 ? "+" : ""}
                {formatCurrency(rollover)}
              </Badge>
            )}
            <span className="text-sm text-muted-foreground">
              {formatCurrency(spent)} / {formatCurrency(effective)}
            </span>
          </div>
        </div>
        <Progress
          value={Math.min(percentage, 100)}
          className={cn(
            "h-2",
            percentage > 100
              ? "[&>div]:bg-red-500"
              : percentage > 80
              ? "[&>div]:bg-yellow-500"
              : "[&>div]:bg-emerald-500"
          )}
        />
        <div className="flex justify-between mt-1">
          <span className="text-xs text-muted-foreground">
            Budget: {formatCurrency(budget)}
          </span>
          <span
            className={cn(
              "text-xs font-medium",
              remaining >= 0 ? "text-emerald-600" : "text-red-500"
            )}
          >
            {remaining >= 0 ? formatCurrency(remaining) + " left" : formatCurrency(Math.abs(remaining)) + " over"}
          </span>
        </div>
      </div>
    </div>
  );
}
