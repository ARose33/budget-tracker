"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveCategory, type BudgetLineItem } from "@/lib/queries/budget";
import { parseAmount, monthLabel } from "@/lib/finance/format";
import { invalidateFinance, saveError } from "@/lib/finance/cache";
export type CategoryDialogMode = {
  action: "create" | "rename" | "rename_group";
  item?: BudgetLineItem;
  group?: string;
  type: string;
};
export function CategoryDialog({
  mode,
  year,
  month,
  close,
}: {
  mode: CategoryDialogMode;
  year: number;
  month: number;
  close: () => void;
}) {
  const client = useQueryClient();
  const [id] = useState(() => mode.item?.category_id ?? crypto.randomUUID());
  const [group, setGroup] = useState(mode.item?.group_name ?? mode.group ?? "");
  const [name, setName] = useState(mode.item?.line_item_name ?? "");
  const [amount, setAmount] = useState("0");
  const mutation = useMutation({
    mutationFn: () =>
      saveCategory({
        action: mode.action,
        id,
        group_name: group.trim(),
        line_item_name: name.trim(),
        category_type: mode.type,
        expected_group: mode.item?.group_name,
        expected_item: mode.item?.line_item_name,
        ...(mode.action === "create"
          ? { year, month, budget_limit: parseAmount(amount) }
          : {}),
      }),
    onSuccess: async () => {
      await invalidateFinance(client);
      close();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) close();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode.action === "create"
              ? "Add " + mode.type.toLowerCase() + " category"
              : mode.action === "rename_group"
                ? "Rename group"
                : "Rename category"}
          </DialogTitle>
          <DialogDescription>
            {mode.action === "create"
              ? "The starting budget applies to " +
                monthLabel(year, month) +
                " only."
              : "Names change everywhere, including historical months. Budget amounts stay the same."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <label className="grid gap-2 text-sm">
            Group name
            <Input
              value={group}
              onChange={(event) => setGroup(event.target.value)}
              maxLength={150}
              required
              disabled={mutation.isPending}
              autoFocus
            />
          </label>
          {mode.action !== "rename_group" ? (
            <label className="grid gap-2 text-sm">
              Category name
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={150}
                required
                disabled={mutation.isPending}
              />
            </label>
          ) : null}
          {mode.action === "create" ? (
            <label className="grid gap-2 text-sm">
              Budget for this month
              <Input
                value={amount}
                inputMode="decimal"
                onChange={(event) => setAmount(event.target.value)}
                required
                disabled={mutation.isPending}
              />
            </label>
          ) : null}
          {mutation.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {saveError(mutation.error)}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={close}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving…" : "Save category"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
