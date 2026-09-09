"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { getBudgetActivity } from "@/lib/queries/budget";
import type { ActivityFilter, BudgetLineItem } from "@/lib/finance/contracts";
import { money, monthLabel, monthKey } from "@/lib/finance/format";
import { saveError } from "@/lib/finance/cache";
import { TransactionEditor } from "@/components/transactions/transaction-editor";
export function ActivityDrawer({ year, month, category, filter, close }: { year: number; month: number; category?: BudgetLineItem; filter: ActivityFilter; close: () => void }) {
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["budget-activity", year, month, category?.category_id, filter, page], queryFn: () => getBudgetActivity(year, month, category?.category_id, filter, page) });
  const title = category?.line_item_name ?? (filter === "uncategorized" ? "Uncategorized activity" : filter === "pending" ? "Pending at the bank" : filter === "review" ? "Categories to review" : "Monthly activity");
  const href = "/transactions?" + new URLSearchParams({ dateFrom: monthKey(year, month) + "-01", dateTo: monthKey(year, month) + "-" + new Date(year, month, 0).getDate(), ...(category ? { categoryId: category.category_id } : {}) }).toString();
  return <Sheet open onOpenChange={open => { if (!open) close(); }}>
    <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl gap-0">
      <SheetHeader className="border-b p-6 pr-14"><SheetTitle className="text-xl">{title}</SheetTitle><SheetDescription>{monthLabel(year, month)} · All accounts · {filter === "pending" ? "Bank pending" : "Posted activity"}</SheetDescription></SheetHeader>
      <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
        {query.isPending ? <p role="status">Loading activity…</p> : query.isError ? <div role="alert">{saveError(query.error)}<Button variant="outline" onClick={() => query.refetch()}>Retry</Button></div> : <>
          <div className="rounded-lg border bg-muted/30 p-4">
            {category ? <><p className="text-xs text-muted-foreground">{filter === "pending" ? "Pending contribution" : category.category_type.toLowerCase() === "income" ? "Actual income" : "Net spent"}</p><p className="text-2xl font-semibold tabular-nums">{money(query.data.total)}</p></> : <p>Outflow {money(query.data.outflow)} · Inflow {money(query.data.inflow)}</p>}
            <p className="mt-1 text-xs text-muted-foreground">{query.data.count} contribution{query.data.count === 1 ? "" : "s"} · Refunds and reversals are netted.</p>
          </div>
          {editing ? <TransactionEditor id={editing} close={() => setEditing(null)} /> : null}
          {query.data.rows.length === 0 ? <p className="py-8 text-center text-muted-foreground">No matching activity this month.</p> : <ul className="divide-y">{query.data.rows.map(row => <li key={row.id}>
            <button className="flex w-full items-start justify-between gap-3 rounded px-2 py-4 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary" onClick={() => setEditing(row.parent_transaction_id)}>
              <span className="min-w-0"><span className="block font-medium">{row.description || "Transaction"}</span><span className="block text-xs text-muted-foreground">{row.date} · {row.account_name}</span>
                {row.allocation ? <span className="mt-1 block text-xs text-muted-foreground">Split allocation · original transaction {money(row.parent_amount)}</span> : null}
                {row.categorization_status === "pending" ? <span className="text-xs text-amber-700">Category awaiting review</span> : null}
              </span><span className="shrink-0 tabular-nums">{money(category ? row.contribution : row.amount)}</span>
            </button>
          </li>)}</ul>}
          <div className="flex items-center justify-between"><Button variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button><span className="text-xs">Page {page + 1} of {Math.max(1, Math.ceil(query.data.count / 50))}</span><Button variant="outline" disabled={(page + 1) * 50 >= query.data.count} onClick={() => setPage(page + 1)}>Next</Button></div>
        </>}
        <Link href={href} className="block text-sm font-medium text-primary underline underline-offset-4">Search this month in Transactions</Link>
      </div>
    </SheetContent>
  </Sheet>;
}
