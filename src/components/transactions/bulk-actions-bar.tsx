"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CategorySelect } from "./category-select";
import { AccountSelect } from "./account-select";
import {
  CheckCircle,
  Archive,
  Tag,
  ShieldCheck,
  Building2,
  Pencil,
  Calendar,
  X,
} from "lucide-react";
import { useState } from "react";
import { saveError } from "@/lib/finance/cache";

type EditMode = null | "category" | "account" | "description" | "date";

interface BulkActionsBarProps {
  selectedCount: number;
  onSetCategory: (categoryId: string | null) => Promise<void>;
  onSetAccount: (accountId: string) => Promise<void>;
  onFinalize: () => Promise<void>;
  onSetDescription: (description: string) => Promise<void>;
  onSetDate: (date: string) => Promise<void>;
  onArchive: () => void;
  onMarkNotDuplicate: () => Promise<void>;
}

export function BulkActionsBar({
  selectedCount,
  onSetCategory,
  onSetAccount,
  onFinalize,
  onSetDescription,
  onSetDate,
  onArchive,
  onMarkNotDuplicate,
}: BulkActionsBarProps) {
  const [editMode, setEditMode] = useState<EditMode>(null);
  const [descValue, setDescValue] = useState("");
  const [dateValue, setDateValue] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<void>) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await action();
      cancelEdit();
    } catch (error) {
      setError(saveError(error));
    } finally {
      setSaving(false);
    }
  };
  if (selectedCount === 0) return null;

  const cancelEdit = () => {
    setEditMode(null);
    setDescValue("");
    setDateValue("");
  };

  return (
    <fieldset
      disabled={saving}
      className="flex items-center gap-2 p-3 bg-muted rounded-lg border flex-wrap"
    >
      {error && (
        <p role="alert" className="w-full text-sm text-destructive">
          {error} Your draft is retained.
        </p>
      )}
      {saving && <p role="status">Saving…</p>}
      <span className="text-sm font-medium mr-2">{selectedCount} selected</span>

      {editMode === "category" && (
        <div className="flex items-center gap-2">
          <CategorySelect
            value={null}
            onValueChange={(v) => {
              void run(() => onSetCategory(v));
            }}
            placeholder="Pick line item"
            className="w-[200px]"
            displayMode="lineItem"
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
              void run(() => onSetAccount(v));
            }}
            placeholder="Pick account"
            className="w-[220px]"
          />
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
              void run(() => onSetDescription(descValue.trim()));
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
              void run(() => onSetDate(dateValue));
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
            Line item
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
            onClick={() => void run(onFinalize)}
          >
            <CheckCircle className="h-3.5 w-3.5 mr-1" />
            Mark Final
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => void run(onMarkNotDuplicate)}
          >
            <ShieldCheck className="h-3.5 w-3.5 mr-1" />
            Not a Duplicate
          </Button>
          <Button variant="destructive" size="sm" onClick={onArchive}>
            <Archive className="h-3.5 w-3.5 mr-1" />
            Archive
          </Button>
        </>
      )}
    </fieldset>
  );
}
