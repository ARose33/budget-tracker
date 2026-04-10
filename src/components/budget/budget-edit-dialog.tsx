"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BudgetLineItem } from "@/lib/queries/budget";

interface BudgetEditDialogProps {
  item: BudgetLineItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (categoryId: string, newLimit: number) => void;
}

export function BudgetEditDialog({
  item,
  open,
  onOpenChange,
  onSave,
}: BudgetEditDialogProps) {
  const [value, setValue] = useState("");

  const handleOpen = (isOpen: boolean) => {
    if (isOpen && item) {
      setValue(String(Number(item.budget_limit)));
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Edit Budget: {item?.group_name} &mdash; {item?.line_item_name}
          </DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <label className="text-sm font-medium mb-2 block">
            Monthly Budget Limit
          </label>
          <Input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="0"
            min={0}
            step={10}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (item) {
                onSave(item.category_id, Number(value));
                onOpenChange(false);
              }
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
