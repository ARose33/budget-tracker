"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  BudgetCategoryType,
  BudgetGroup,
  BudgetLineItem,
} from "@/lib/queries/budget";

type BudgetDialogMode =
  | { type: "add-group"; categoryType: BudgetCategoryType }
  | { type: "add-item"; group: BudgetGroup }
  | { type: "edit-item"; item: BudgetLineItem }
  | { type: "edit-group"; group: BudgetGroup };

export interface BudgetFormValues {
  groupName: string;
  lineItemName: string;
  budgetLimit: number;
}

interface BudgetEditDialogProps {
  mode: BudgetDialogMode | null;
  open: boolean;
  isSaving?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (values: BudgetFormValues) => void;
}

function getDialogTitle(mode: BudgetDialogMode | null) {
  if (!mode) return "Budget";
  if (mode.type === "add-group") {
    return `Add ${mode.categoryType.toLowerCase()} category`;
  }
  if (mode.type === "add-item") {
    return `Add subcategory to ${mode.group.group_name}`;
  }
  if (mode.type === "edit-group") return "Edit category";
  return "Edit subcategory";
}

export function BudgetEditDialog({
  mode,
  open,
  isSaving = false,
  onOpenChange,
  onSave,
}: BudgetEditDialogProps) {
  const initialValues = useMemo<BudgetFormValues>(() => {
    if (!mode) {
      return { groupName: "", lineItemName: "", budgetLimit: 0 };
    }
    if (mode.type === "add-group") {
      return { groupName: "", lineItemName: "", budgetLimit: 0 };
    }
    if (mode.type === "add-item") {
      return { groupName: mode.group.group_name, lineItemName: "", budgetLimit: 0 };
    }
    if (mode.type === "edit-group") {
      return {
        groupName: mode.group.group_name,
        lineItemName: "",
        budgetLimit: Number(mode.group.total_budget),
      };
    }
    return {
      groupName: mode.item.group_name,
      lineItemName: mode.item.line_item_name,
      budgetLimit: Number(mode.item.budget_limit),
    };
  }, [mode]);

  const [groupName, setGroupName] = useState(initialValues.groupName);
  const [lineItemName, setLineItemName] = useState(initialValues.lineItemName);
  const [budgetLimit, setBudgetLimit] = useState(String(initialValues.budgetLimit));

  const showGroupName = mode?.type === "add-group" || mode?.type === "edit-group";
  const showLineItemName =
    mode?.type === "add-group" ||
    mode?.type === "add-item" ||
    mode?.type === "edit-item";
  const showBudgetLimit = mode?.type !== "edit-group";

  const handleSubmit = () => {
    onSave({
      groupName,
      lineItemName,
      budgetLimit: Number(budgetLimit),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{getDialogTitle(mode)}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          {showGroupName && (
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="budget-group-name">
                Category name
              </label>
              <Input
                id="budget-group-name"
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder="Housing"
                autoFocus
              />
            </div>
          )}

          {mode?.type === "add-item" && (
            <div className="grid gap-1">
              <span className="text-sm font-medium">Category</span>
              <span className="text-sm text-muted-foreground">{mode.group.group_name}</span>
            </div>
          )}

          {showLineItemName && (
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="budget-line-item-name">
                Subcategory name
              </label>
              <Input
                id="budget-line-item-name"
                value={lineItemName}
                onChange={(event) => setLineItemName(event.target.value)}
                placeholder="Rent"
                autoFocus={!showGroupName}
              />
            </div>
          )}

          {showBudgetLimit && (
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="budget-limit">
                Monthly budget
              </label>
              <Input
                id="budget-limit"
                type="number"
                value={budgetLimit}
                onChange={(event) => setBudgetLimit(event.target.value)}
                placeholder="0"
                min={0}
                step={10}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type { BudgetDialogMode };
