"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CategorySelect } from "./category-select";
import { AccountSelect } from "./account-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle,
  Trash2,
  Tag,
  ShieldCheck,
  Building2,
  Pencil,
  Calendar,
  X,
} from "lucide-react";
import { useState } from "react";

type EditMode = null | "category" | "account" | "status" | "description" | "date";

interface BulkActionsBarProps {
  selectedCount: number;
  onSetCategory: (categoryId: string) => void;
  onSetAccount: (accountId: string) => void;
  onSetStatus: (status: string) => void;
  onSetDescription: (description: string) => void;
  onSetDate: (date: string) => void;
  onDelete: () => void;
  onMarkNotDuplicate: () => void;
}

export function BulkActionsBar({
  selectedCount,
  onSetCategory,
  onSetAccount,
  onSetStatus,
  onSetDescription,
  onSetDate,
  onDelete,
  onMarkNotDuplicate,
}: BulkActionsBarProps) {
  const [editMode, setEditMode] = useState<EditMode>(null);
  const [descValue, setDescValue] = useState("");
  const [dateValue, setDateValue] = useState("");

  if (selectedCount === 0) return null;

  const cancelEdit = () => {
    setEditMode(null);
    setDescValue("");
    setDateValue("");
  };

  return (
    <div className="flex items-center gap-2 p-3 bg-muted rounded-lg border flex-wrap">
      <span className="text-sm font-medium mr-2">
        {selectedCount} selected
      </span>

      {editMode === "category" && (
        <div className="flex items-center gap-2">
          <CategorySelect
            value={null}
            onValueChange={(v) => {
              onSetCategory(v);
              cancelEdit();
            }}
            placeholder="Pick category"
            className="w-[200px]"
          />
          <Button variant="ghost" size="sm" onClick={cancelEdit}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {editMode === "account" && (
        <div className="flex items-center gap-2">
          <AccountSelect
            value={null}
            onValueChange={(v) => {
              onSetAccount(v);
              cancelEdit();
            }}
            placeholder="Pick account"
            className="w-[220px]"
          />
          <Button variant="ghost" size="sm" onClick={cancelEdit}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {editMode === "status" && (
        <div className="flex items-center gap-2">
          <Select
            onValueChange={(v) => {
              if (v) {
                onSetStatus(v as string);
                cancelEdit();
              }
            }}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Pick status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Confirmed">Confirmed</SelectItem>
              <SelectItem value="Unconfirmed">Unconfirmed</SelectItem>
              <SelectItem value="Pending">Pending</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" onClick={cancelEdit}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {editMode === "description" && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (descValue.trim()) {
              onSetDescription(descValue.trim());
              cancelEdit();
            }
          }}
        >
          <Input
            placeholder="New description"
            value={descValue}
            onChange={(e) => setDescValue(e.target.value)}
            className="w-[220px] h-8"
            autoFocus
          />
          <Button type="submit" size="sm" disabled={!descValue.trim()}>
            Apply
          </Button>
          <Button variant="ghost" size="sm" onClick={cancelEdit}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </form>
      )}

      {editMode === "date" && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (dateValue) {
              onSetDate(dateValue);
              cancelEdit();
            }
          }}
        >
          <Input
            type="date"
            value={dateValue}
            onChange={(e) => setDateValue(e.target.value)}
            className="w-[170px] h-8"
            autoFocus
          />
          <Button type="submit" size="sm" disabled={!dateValue}>
            Apply
          </Button>
          <Button variant="ghost" size="sm" onClick={cancelEdit}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </form>
      )}

      {editMode === null && (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditMode("category")}
          >
            <Tag className="h-3.5 w-3.5 mr-1" />
            Category
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditMode("account")}
          >
            <Building2 className="h-3.5 w-3.5 mr-1" />
            Account
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditMode("status")}
          >
            <CheckCircle className="h-3.5 w-3.5 mr-1" />
            Status
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditMode("description")}
          >
            <Pencil className="h-3.5 w-3.5 mr-1" />
            Description
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditMode("date")}
          >
            <Calendar className="h-3.5 w-3.5 mr-1" />
            Date
          </Button>
          <Button variant="outline" size="sm" onClick={onMarkNotDuplicate}>
            <ShieldCheck className="h-3.5 w-3.5 mr-1" />
            Not a Duplicate
          </Button>
          <Button variant="destructive" size="sm" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Delete
          </Button>
        </>
      )}
    </div>
  );
}
