"use client";

import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { BudgetLineItemRow } from "./budget-line-item";
import type { BudgetGroup } from "@/lib/queries/budget";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

interface BudgetGroupCardProps {
  group: BudgetGroup;
  onEditItem?: (categoryId: string) => void;
}

export function BudgetGroupCard({ group, onEditItem }: BudgetGroupCardProps) {
  const [open, setOpen] = useState(true);
  const percentage =
    group.total_effective > 0
      ? (group.total_spent / group.total_effective) * 100
      : 0;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center justify-between w-full px-4 py-3 rounded-lg bg-card border hover:bg-accent/50 transition-colors">
        <div className="flex items-center gap-2">
          <ChevronRight
            className={cn(
              "h-4 w-4 transition-transform",
              open && "rotate-90"
            )}
          />
          <span className="font-semibold">{group.group_name}</span>
          <span className="text-xs text-muted-foreground ml-1">
            ({group.items.length})
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "text-sm font-medium",
              percentage > 100 ? "text-red-500" : "text-muted-foreground"
            )}
          >
            {formatCurrency(group.total_spent)} /{" "}
            {formatCurrency(group.total_effective)}
          </span>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-2 mt-1 border-l-2 border-border pl-2">
          {group.items.map((item) => (
            <BudgetLineItemRow
              key={item.category_id}
              item={item}
              onClick={() => onEditItem?.(item.category_id)}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
