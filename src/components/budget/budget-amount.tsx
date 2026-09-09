"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveBudgets, type BudgetLineItem } from "@/lib/queries/budget";
import { invalidateFinance, saveError } from "@/lib/finance/cache";
import { money, monthLabel, parseAmount } from "@/lib/finance/format";
export function BudgetAmount({ item, year, month }: { item: BudgetLineItem; year: number; month: number }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [version, setVersion] = useState(item.row_version);
  const mutation = useMutation({
    mutationFn: () => saveBudgets([{ category_id: item.category_id, year, month, budget_limit: parseAmount(draft), expected_version: version }]),
    onSuccess: async () => { setEditing(false); await invalidateFinance(client); },
  });
  if (!editing) return <Button variant="ghost" className="h-auto min-h-10 px-2 tabular-nums" aria-label={"Edit " + item.line_item_name + " budget for " + monthLabel(year, month)} onClick={() => { setVersion(item.row_version); setDraft(item.budget_limit.toFixed(2)); mutation.reset(); setEditing(true); }}>
    {item.has_budget ? money(item.budget_limit) : <span className="text-muted-foreground">Set budget</span>}<Pencil className="size-3 text-muted-foreground" />
  </Button>;
  return <form className="space-y-1" onSubmit={event => { event.preventDefault(); mutation.mutate(); }}>
    <div className="flex items-center justify-end gap-1">
      <Input aria-label={item.line_item_name + " budget amount"} className="w-24 text-right tabular-nums" inputMode="decimal" value={draft} autoFocus disabled={mutation.isPending} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Escape" && !mutation.isPending) setEditing(false); }} />
      <Button size="icon-sm" type="submit" disabled={mutation.isPending} aria-label="Save monthly budget"><Check className="size-4" /></Button>
      <Button size="icon-sm" variant="ghost" disabled={mutation.isPending} onClick={() => setEditing(false)} aria-label="Cancel budget edit"><X className="size-4" /></Button>
    </div>
    <p className="text-xs text-muted-foreground">{mutation.isPending ? "Saving…" : "This month only"}</p>
    {mutation.isError ? <p role="alert" className="max-w-64 text-xs text-destructive">{saveError(mutation.error)}</p> : null}
  </form>;
}
