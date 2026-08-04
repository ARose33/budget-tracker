"use client";

import { useState } from "react";
import { Loader2, Plus, Scissors, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CategorySelect } from "@/components/transactions/category-select";
import {
  splitTransaction,
  unsplitTransaction,
  type Transaction,
} from "@/lib/queries/transactions";
import { cn } from "@/lib/utils";

interface DraftAllocation {
  key: string;
  categoryId: string | null;
  amount: string;
  description: string;
}

function draftKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function emptyAllocation(): DraftAllocation {
  return { key: draftKey(), categoryId: null, amount: "", description: "" };
}

function formatCurrencyFromCents(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Math.abs(cents) / 100);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not update transaction split";
}

export function SplitTransactionDialog({
  transaction,
  onSaved,
}: {
  transaction: Transaction;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [allocations, setAllocations] = useState<DraftAllocation[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmUnsplit, setConfirmUnsplit] = useState(false);

  const initialize = () => {
    setConfirmUnsplit(false);
    setAllocations(
      transaction.allocations.length >= 2
        ? transaction.allocations.map((allocation) => ({
            key: allocation.id,
            categoryId: allocation.category_id,
            amount: Math.abs(allocation.amount).toFixed(2),
            description:
              allocation.description === transaction.description
                ? ""
                : allocation.description ?? "",
          }))
        : [emptyAllocation(), emptyAllocation()]
    );
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) initialize();
    setOpen(nextOpen);
  };

  const totalCents = Math.round(Math.abs(transaction.amount) * 100);
  const allocatedCents = allocations.reduce((total, allocation) => {
    const parsed = Number(allocation.amount);
    return total + (Number.isFinite(parsed) ? Math.round(parsed * 100) : 0);
  }, 0);
  const remainingCents = totalCents - allocatedCents;
  const allocationsValid = allocations.every((allocation) => {
    const parsed = Number(allocation.amount);
    return (
      allocation.categoryId !== null &&
      /^\d+(?:\.\d{1,2})?$/.test(allocation.amount.trim()) &&
      Number.isFinite(parsed) &&
      parsed > 0
    );
  });
  const canSave =
    allocations.length >= 2 && allocationsValid && remainingCents === 0 && !isSaving;

  const updateAllocation = (
    key: string,
    patch: Partial<Omit<DraftAllocation, "key">>
  ) => {
    setAllocations((current) =>
      current.map((allocation) =>
        allocation.key === key ? { ...allocation, ...patch } : allocation
      )
    );
  };

  const save = async () => {
    if (!canSave) return;
    setIsSaving(true);
    try {
      const sign = transaction.amount < 0 ? -1 : 1;
      await splitTransaction(
        transaction.id,
        allocations.map((allocation) => ({
          category_id: allocation.categoryId!,
          amount: sign * (Math.round(Number(allocation.amount) * 100) / 100),
          description: allocation.description.trim() || undefined,
        }))
      );
      toast.success(transaction.is_split ? "Transaction split updated" : "Transaction split");
      setOpen(false);
      onSaved();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const unsplit = async () => {
    if (!confirmUnsplit) {
      setConfirmUnsplit(true);
      return;
    }

    setIsSaving(true);
    try {
      await unsplitTransaction(transaction.id);
      toast.success("Transaction split removed");
      setOpen(false);
      onSaved();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setIsSaving(false);
      setConfirmUnsplit(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => handleOpenChange(true)}
        aria-label={transaction.is_split ? "Edit transaction split" : "Split transaction"}
        title={transaction.is_split ? "Edit split" : "Split transaction"}
      >
        <Scissors className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {transaction.is_split ? "Edit transaction split" : "Split transaction"}
            </DialogTitle>
            <DialogDescription>
              Allocate {formatCurrencyFromCents(totalCents)} from {transaction.description || "this transaction"}.
              The original bank transaction stays unchanged for reconciliation.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
            {allocations.map((allocation, index) => (
              <div
                key={allocation.key}
                className="grid gap-2 rounded-lg border bg-muted/20 p-3 sm:grid-cols-[minmax(0,1.5fr)_110px_36px]"
              >
                <div className="space-y-2">
                  <label className="text-xs font-medium" htmlFor={`split-description-${allocation.key}`}>
                    Allocation {index + 1}
                  </label>
                  <CategorySelect
                    value={allocation.categoryId}
                    onValueChange={(categoryId) =>
                      updateAllocation(allocation.key, { categoryId })
                    }
                    includeUncategorized={false}
                    className="w-full"
                  />
                  <Input
                    id={`split-description-${allocation.key}`}
                    value={allocation.description}
                    onChange={(event) =>
                      updateAllocation(allocation.key, { description: event.target.value })
                    }
                    placeholder="Optional description"
                    maxLength={250}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium" htmlFor={`split-amount-${allocation.key}`}>
                    Amount
                  </label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input
                      id={`split-amount-${allocation.key}`}
                      type="number"
                      min="0.01"
                      step="0.01"
                      inputMode="decimal"
                      value={allocation.amount}
                      onChange={(event) =>
                        updateAllocation(allocation.key, { amount: event.target.value })
                      }
                      className="pl-6 text-right tabular-nums"
                      aria-invalid={Boolean(allocation.amount) && Number(allocation.amount) <= 0}
                    />
                  </div>
                </div>
                <div className="flex items-start sm:pt-6">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={allocations.length <= 2}
                    onClick={() =>
                      setAllocations((current) =>
                        current.filter((item) => item.key !== allocation.key)
                      )
                    }
                    aria-label={`Remove allocation ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAllocations((current) => [...current, emptyAllocation()])}
            >
              <Plus className="h-4 w-4" />
              Add allocation
            </Button>
          </div>

          <div
            className={cn(
              "flex items-center justify-between rounded-lg border px-3 py-2 text-sm",
              remainingCents === 0
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : remainingCents < 0
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-amber-200 bg-amber-50 text-amber-800"
            )}
          >
            <span>{remainingCents < 0 ? "Over allocated" : "Remaining"}</span>
            <span className="font-semibold tabular-nums">
              {formatCurrencyFromCents(remainingCents)}
            </span>
          </div>

          <DialogFooter className={cn(transaction.is_split && "sm:justify-between")}>
            {transaction.is_split && (
              <Button
                type="button"
                variant="outline"
                onClick={unsplit}
                disabled={isSaving}
                className={cn(confirmUnsplit && "border-red-300 text-red-700")}
              >
                {confirmUnsplit ? "Confirm remove split" : "Remove split"}
              </Button>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={isSaving}>
                Cancel
              </Button>
              <Button onClick={save} disabled={!canSave}>
                {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                Save split
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
