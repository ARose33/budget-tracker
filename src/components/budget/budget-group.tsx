"use client";

import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ChevronRight, Pencil, Plus } from "lucide-react";
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
  onAddItem?: (group: BudgetGroup) => void;
  onEditGroup?: (group: BudgetGroup) => void;
}

export function BudgetGroupCard({
  group,
  onEditItem,
  onAddItem,
  onEditGroup,
}: BudgetGroupCardProps) {
  const [open, setOpen] = useState(false);
  const percentage =
    group.total_effective > 0
      ? (group.total_spent / group.total_effective) * 100
      : 0;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 transition-colors hover:bg-accent/50">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left">
          <div className="flex min-w-0 items-center gap-2">
            <ChevronRight
              className={cn(
                "h-4 w-4 shrink-0 transition-transform",
                open && "rotate-90"
              )}
            />
            <span className="truncate font-semibold">{group.group_name}</span>
            <span className="text-xs text-muted-foreground">
              ({group.items.length})
            </span>
          </div>
          <span
            className={cn(
              "shrink-0 text-sm font-medium",
              percentage > 100 ? "text-red-500" : "text-muted-foreground"
            )}
          >
            {formatCurrency(group.total_spent)} /{" "}
            {formatCurrency(group.total_effective)}
          </span>
        </CollapsibleTrigger>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            aria-label={`Add subcategory to ${group.group_name}`}
            title={`Add subcategory to ${group.group_name}`}
            size="sm"
            variant="outline"
            onClick={() => onAddItem?.(group)}
          >
            <Plus />
            Subcategory
          </Button>
          <Button
            aria-label={`Edit ${group.group_name} category`}
            title={`Edit ${group.group_name} category`}
            size="icon-sm"
            variant="ghost"
            onClick={() => onEditGroup?.(group)}
          >
            <Pencil />
          </Button>
        </div>
      </div>
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
