"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  getBudgetWorkspace,
  saveBudgets,
  type BudgetLineItem,
} from "@/lib/queries/budget";
import { monthKey, monthLabel, money } from "@/lib/finance/format";
import { invalidateFinance, saveError } from "@/lib/finance/cache";
export function CopyBudgetsDialog({
  items,
  year,
  month,
  close,
}: {
  items: BudgetLineItem[];
  year: number;
  month: number;
  close: () => void;
}) {
  const client = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const months = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(year, month + index, 1);
    return { year: date.getFullYear(), month: date.getMonth() + 1 };
  });
  const targets = months.filter((target) =>
    selected.includes(monthKey(target.year, target.month)),
  );
  const [source] = useState(() => items.filter((item) => item.has_budget));
  const preview = useMutation({
    mutationFn: async () =>
      Promise.all(
        targets.map(async (target) => ({
          ...target,
          workspace: await getBudgetWorkspace(target.year, target.month),
        })),
      ),
  });
  const mutation = useMutation({
    mutationFn: async () => {
      if (!preview.data || !selected.length || preview.isPending)
        throw new Error("Review the selected months before saving.");
      await saveBudgets(
        preview.data.flatMap((target) =>
          source.map((item) => ({
            category_id: item.category_id,
            year: target.year,
            month: target.month,
            budget_limit: item.budget_limit,
            expected_version:
              target.workspace.items.find(
                (row) => row.category_id === item.category_id,
              )?.row_version ?? null,
          })),
        ),
      );
    },
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
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Copy monthly budgets</DialogTitle>
          <DialogDescription>
            Copy saved amounts from {monthLabel(year, month)} to the exact
            months you select. Carryover is calculated separately.
          </DialogDescription>
        </DialogHeader>
        {!reviewing ? (
          <fieldset className="grid grid-cols-2 gap-2">
            <legend className="mb-3 text-sm font-medium">
              Choose future months
            </legend>
            {months.map((target) => {
              const key = monthKey(target.year, target.month);
              return (
                <label
                  key={key}
                  className="flex min-h-11 items-center gap-2 rounded border p-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(key)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, key].sort()
                          : current.filter((value) => value !== key),
                      )
                    }
                  />
                  {monthLabel(target.year, target.month)}
                </label>
              );
            })}
          </fieldset>
        ) : (
          <div className="space-y-3 text-sm">
            <p>
              {source.length} saved category amounts per month. Unset categories
              will stay as they are.
            </p>
            {preview.isPending ? (
              <p role="status">Loading the current budgets…</p>
            ) : null}
            {preview.isError ? (
              <p role="alert">
                {saveError(preview.error)}{" "}
                <Button variant="outline" onClick={() => preview.mutate()}>
                  Retry
                </Button>
              </p>
            ) : null}
            {preview.data?.map((target) => (
              <div
                key={monthKey(target.year, target.month)}
                className="rounded border p-3"
              >
                <p className="font-medium">
                  {monthLabel(target.year, target.month)}
                </p>
                <ul className="mt-2 space-y-1">
                  {source.map((item) => (
                    <li
                      key={item.category_id}
                      className="flex justify-between gap-3 text-xs"
                    >
                      <span>
                        {item.group_name}: {item.line_item_name} (
                        {item.category_type.toLowerCase()})
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {money(
                          target.workspace.items.find(
                            (row) => row.category_id === item.category_id,
                          )?.budget_limit ?? 0,
                        )}{" "}
                        → {money(item.budget_limit)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        {mutation.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {saveError(mutation.error)} Reopen this review to load current
            versions.
          </p>
        ) : null}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => (reviewing ? setReviewing(false) : close())}
          >
            {reviewing ? "Back" : "Cancel"}
          </Button>
          {reviewing ? (
            <Button
              disabled={
                mutation.isPending ||
                !preview.data ||
                preview.isPending ||
                preview.isError
              }
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? "Saving…" : "Save to selected months"}
            </Button>
          ) : (
            <Button
              disabled={!selected.length || !source.length}
              onClick={() => {
                setReviewing(true);
                preview.mutate();
              }}
            >
              Review changes
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
