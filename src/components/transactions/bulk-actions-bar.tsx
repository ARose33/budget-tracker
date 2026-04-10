"use client";

import { Button } from "@/components/ui/button";
import { CategorySelect } from "./category-select";
import { CheckCircle, Trash2, Tag } from "lucide-react";
import { useState } from "react";

interface BulkActionsBarProps {
  selectedCount: number;
  onSetCategory: (categoryId: string) => void;
  onConfirmAll: () => void;
  onDelete: () => void;
}

export function BulkActionsBar({
  selectedCount,
  onSetCategory,
  onConfirmAll,
  onDelete,
}: BulkActionsBarProps) {
  const [showCategorySelect, setShowCategorySelect] = useState(false);

  if (selectedCount === 0) return null;

  return (
    <div className="flex items-center gap-2 p-3 bg-muted rounded-lg border">
      <span className="text-sm font-medium mr-2">
        {selectedCount} selected
      </span>
      {showCategorySelect ? (
        <div className="flex items-center gap-2">
          <CategorySelect
            value={null}
            onValueChange={(v) => {
              onSetCategory(v);
              setShowCategorySelect(false);
            }}
            placeholder="Pick category"
            className="w-[200px]"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowCategorySelect(false)}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowCategorySelect(true)}
        >
          <Tag className="h-3.5 w-3.5 mr-1" />
          Set Category
        </Button>
      )}
      <Button variant="outline" size="sm" onClick={onConfirmAll}>
        <CheckCircle className="h-3.5 w-3.5 mr-1" />
        Confirm
      </Button>
      <Button variant="destructive" size="sm" onClick={onDelete}>
        <Trash2 className="h-3.5 w-3.5 mr-1" />
        Delete
      </Button>
    </div>
  );
}
