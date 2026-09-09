"use client";
import { Suspense, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  Copy,
  HelpCircle,
  Pencil,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MonthPicker } from "@/components/layout/month-picker";
import { BudgetAmount } from "@/components/budget/budget-amount";
import {
  CategoryDialog,
  type CategoryDialogMode,
} from "@/components/budget/category-dialog";
import { CopyBudgetsDialog } from "@/components/budget/copy-budgets-dialog";
import { ActivityDrawer } from "@/components/budget/activity-drawer";
import {
  getBudgetWorkspace,
  groupBudgetItems,
  type BudgetGroup,
} from "@/lib/queries/budget";
import { calculateBudgetTotals } from "@/lib/budget-math";
import { money } from "@/lib/finance/format";
import type { ActivityFilter, BudgetLineItem } from "@/lib/finance/contracts";
import { saveError } from "@/lib/finance/cache";
import { useMonthSelector } from "@/hooks/use-month-selector";
import { cn } from "@/lib/utils";

function BudgetContent() {
  const { year, month, label } = useMonthSelector();
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [dialog, setDialog] = useState<CategoryDialogMode | null>(null);
  const [copying, setCopying] = useState(false);
  const query = useQuery({
    queryKey: ["budget", year, month],
    queryFn: () => getBudgetWorkspace(year, month),
  });
  const groups = groupBudgetItems(query.data?.items ?? []);
  const totals = calculateBudgetTotals(groups);
  const categoryId = search.get("category");
  const selected = query.data?.items.find(
    (item) => item.category_id === categoryId,
  );
  const requestedFilter = search.get("activity");
  const filter: ActivityFilter =
    requestedFilter === "pending" ||
    requestedFilter === "uncategorized" ||
    requestedFilter === "review"
      ? requestedFilter
      : "booked";
  const openActivity = (
    item?: BudgetLineItem,
    nextFilter: ActivityFilter = "booked",
  ) => {
    const params = new URLSearchParams(search.toString());
    params.set("year", String(year));
    params.set("month", String(month));
    if (item) params.set("category", item.category_id);
    else params.delete("category");
    params.set("activity", nextFilter);
    router.push(pathname + "?" + params.toString(), { scroll: false });
  };
  const closeActivity = () => {
    const params = new URLSearchParams(search.toString());
    params.delete("category");
    params.delete("activity");
    router.replace(pathname + "?" + params.toString(), { scroll: false });
  };
  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            Your monthly plan
          </p>
          <h1 className="text-3xl tracking-tight">Budget</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Plan the month. See where it goes.
          </p>
        </div>
        <MonthPicker />
      </header>
      {query.isPending ? (
        <div
          role="status"
          className="rounded-xl border bg-card p-12 text-center text-muted-foreground"
        >
          Loading {label}…
        </div>
      ) : query.isError ? (
        <div role="alert" className="rounded-xl border bg-card p-6">
          <h2 className="font-semibold">Budget could not be loaded</h2>
          <p className="my-2 text-sm">{saveError(query.error)}</p>
          <Button variant="outline" onClick={() => query.refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          <section
            aria-label="Monthly summary"
            className="overflow-hidden rounded-xl border bg-card"
          >
            <div className="grid grid-cols-2 divide-x sm:grid-cols-4">
              <Summary
                label="Budgeted expenses"
                value={totals.budgetedExpenses}
              />
              <Summary
                label="Carryover"
                value={totals.expenseRollover}
                detail="From earlier months"
              />
              <Summary
                label="Net spent"
                value={totals.actualExpenses}
                detail="Posted expenses, less refunds"
              />
              <Summary
                label="Budget remaining"
                value={totals.remainingExpenses}
                detail="Budget + carryover − spent"
                negative={totals.remainingExpenses < 0}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/20 px-5 py-3 text-xs text-muted-foreground">
              <span>All accounts, including hidden accounts · USD</span>
              <span>
                Budget remaining is a plan balance, not cash available.
              </span>
            </div>
          </section>
          <div
            className="flex flex-wrap items-center gap-2"
            aria-label="Needs attention"
          >
            <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Needs attention
            </span>
            <Attention
              label="uncategorized"
              count={query.data.attention.uncategorized_count}
              onClick={() => openActivity(undefined, "uncategorized")}
            />
            <Attention
              label="categories to review"
              count={query.data.attention.review_count}
              onClick={() => openActivity(undefined, "review")}
            />
            <Attention
              label="pending at bank"
              count={query.data.attention.pending_count}
              onClick={() => openActivity(undefined, "pending")}
            />
            {query.data.attention.uncategorized_count > 0 ? (
              <p className="basis-full text-xs text-muted-foreground">
                Uncategorized outflow{" "}
                {money(query.data.attention.uncategorized_outflow)} and inflow{" "}
                {money(query.data.attention.uncategorized_inflow)} are outside
                category totals.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Expense categories</h2>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCopying(true)}
                disabled={!query.data.items.some((item) => item.has_budget)}
              >
                <Copy className="size-4" />
                Copy budgets
              </Button>
              <Button
                size="sm"
                onClick={() => setDialog({ action: "create", type: "Expense" })}
              >
                <Plus className="size-4" />
                Add category
              </Button>
            </div>
          </div>
          {groups.filter(
            (group) => group.category_type.toLowerCase() === "expense",
          ).length ? (
            <div className="space-y-4">
              {groups
                .filter(
                  (group) => group.category_type.toLowerCase() === "expense",
                )
                .map((group) => (
                  <CategoryGroup
                    key={group.category_type + group.group_name}
                    group={group}
                    year={year}
                    month={month}
                    openActivity={openActivity}
                    edit={setDialog}
                  />
                ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-8 text-center">
              <h3 className="font-semibold">Start with one category</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Add an expense category and set its amount for {label}.
              </p>
            </div>
          )}
          <section className="space-y-4 pt-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Income</h2>
                <p className="text-xs text-muted-foreground">
                  Planned {money(totals.budgetedIncome)} · Actual{" "}
                  {money(totals.actualIncome)}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDialog({ action: "create", type: "Income" })}
              >
                <Plus className="size-4" />
                Add income
              </Button>
            </div>
            {groups
              .filter((group) => group.category_type.toLowerCase() === "income")
              .map((group) => (
                <CategoryGroup
                  key={group.category_type + group.group_name}
                  group={group}
                  year={year}
                  month={month}
                  openActivity={openActivity}
                  edit={setDialog}
                />
              ))}
          </section>
          <details className="rounded-lg border bg-card p-4 text-sm">
            <summary className="cursor-pointer font-medium">
              <HelpCircle className="mr-2 inline size-4 text-muted-foreground" />
              How these totals work
            </summary>
            <div className="mt-3 max-w-3xl space-y-2 text-muted-foreground">
              <p>
                Posted expense charges increase spent; refunds reduce it. Actual
                income includes reversals. A split contributes only its
                allocation to each category.
              </p>
              <p>
                Bank-pending transactions are shown separately. Categories
                awaiting review still contribute to posted totals. Transfer
                categories, including payments categorized as transfers, are
                excluded from income and expenses. StackMint does not infer
                transfers from descriptions.
              </p>
              <p>
                Expense carryover includes surplus and overspending from the
                first saved budget through the prior month, including months
                with no budget. Income has no carryover. Editing an earlier
                budget can change later carryover.
              </p>
              <p>
                Amounts save to the displayed month only. Copy budgets lets you
                review specific future months. Names apply across all months.
                Opening a month never creates a budget.
              </p>
              <p>
                All owned accounts are included. Historical archived or
                source-removed activity remains accessible in Transactions.
                Amounts use the existing USD presentation; currency conversion
                is unavailable.
              </p>
            </div>
          </details>
        </>
      )}
      {dialog ? (
        <CategoryDialog
          key={
            dialog.action +
            (dialog.item?.category_id ?? dialog.type) +
            year +
            month
          }
          mode={dialog}
          year={year}
          month={month}
          close={() => setDialog(null)}
        />
      ) : null}
      {copying && query.data ? (
        <CopyBudgetsDialog
          items={query.data.items}
          year={year}
          month={month}
          close={() => setCopying(false)}
        />
      ) : null}
      {(categoryId || requestedFilter) && query.data ? (
        selected || !categoryId ? (
          <ActivityDrawer
            key={[year, month, categoryId, filter].join(":")}
            year={year}
            month={month}
            category={selected}
            filter={filter}
            close={closeActivity}
          />
        ) : (
          <div role="alert">
            This category is unavailable.{" "}
            <Button variant="outline" onClick={closeActivity}>
              Close category
            </Button>
          </div>
        )
      ) : null}
    </div>
  );
}
function Summary({
  label,
  value,
  detail,
  negative,
}: {
  label: string;
  value: number;
  detail?: string;
  negative?: boolean;
}) {
  return (
    <div className="min-w-0 p-4 sm:p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-2 break-words text-xl font-semibold tracking-tight tabular-nums lg:text-2xl",
          negative && "text-destructive",
        )}
      >
        {money(value)}
      </p>
      {detail ? (
        <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>
      ) : null}
    </div>
  );
}
function Attention({
  label,
  count,
  onClick,
}: {
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className={
        count
          ? "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100"
          : "text-muted-foreground"
      }
      onClick={onClick}
    >
      <span className="font-semibold">{count}</span>
      {label}
      <ChevronRight className="size-3" />
    </Button>
  );
}
function CategoryGroup({
  group,
  year,
  month,
  openActivity,
  edit,
}: {
  group: BudgetGroup;
  year: number;
  month: number;
  openActivity: (item: BudgetLineItem, filter?: ActivityFilter) => void;
  edit: (mode: CategoryDialogMode) => void;
}) {
  const income = group.category_type.toLowerCase() === "income";
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-2 bg-muted/35 px-4 py-3">
        <h3 className="flex items-center gap-2 font-semibold">
          {income ? (
            <ArrowDownLeft className="size-4 text-primary" />
          ) : (
            <ArrowUpRight className="size-4 text-muted-foreground" />
          )}
          {group.group_name}
        </h3>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={"Rename " + group.group_name + " group"}
            onClick={() =>
              edit({
                action: "rename_group",
                item: group.items[0],
                type: group.category_type,
              })
            }
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={"Add category to " + group.group_name}
            onClick={() =>
              edit({
                action: "create",
                group: group.group_name,
                type: group.category_type,
              })
            }
          >
            <Plus className="size-4" />
          </Button>
        </div>
      </div>
      <div className="hidden grid-cols-[minmax(0,1fr)_180px_125px_140px] gap-3 border-b px-5 py-2 text-right text-xs text-muted-foreground md:grid">
        <span className="text-left">Category</span>
        <span>{income ? "Planned" : "Budgeted"}</span>
        <span>{income ? "Actual" : "Spent"}</span>
        <span>{income ? "Still to earn" : "Remaining"}</span>
      </div>
      <ul className="divide-y">
        {group.items.map((item) => {
          const remaining =
            Math.round((item.effective_budget - item.actual_spent) * 100) / 100;
          const overspent = !income && remaining < 0;
          const progress =
            item.effective_budget > 0
              ? Math.min(
                  100,
                  Math.max(
                    0,
                    (item.actual_spent / item.effective_budget) * 100,
                  ),
                )
              : item.actual_spent > 0
                ? 100
                : 0;
          return (
            <li
              key={item.category_id}
              className="grid grid-cols-3 gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_180px_125px_140px] md:items-center md:px-5"
            >
              <div className="col-span-3 min-w-0 md:col-span-1">
                <div className="flex items-center gap-1">
                  <button
                    className="group flex min-h-9 min-w-0 items-center gap-1 text-left font-medium hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
                    onClick={() => openActivity(item)}
                  >
                    {item.line_item_name}
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={"Rename " + item.line_item_name}
                    onClick={() =>
                      edit({ action: "rename", item, type: item.category_type })
                    }
                  >
                    <Pencil className="size-3 text-muted-foreground" />
                  </Button>
                </div>
                {!income ? (
                  <>
                    <div
                      className="my-1 h-1 max-w-72 overflow-hidden rounded-full bg-muted"
                      role="img"
                      aria-label={
                        overspent
                          ? money(-remaining) + " over budget"
                          : money(item.actual_spent) +
                            " spent of " +
                            money(item.effective_budget)
                      }
                    >
                      <div
                        className={cn(
                          "h-full rounded-full",
                          overspent ? "bg-destructive" : "bg-primary",
                        )}
                        style={{ width: progress + "%" }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Carryover {money(item.rollover)}
                      {item.review_count
                        ? " · " + item.review_count + " to review"
                        : ""}
                    </p>
                  </>
                ) : null}
              </div>
              <div className="flex flex-col items-end justify-between gap-1 md:block md:text-right">
                <span className="text-xs text-muted-foreground md:hidden">
                  {income ? "Planned" : "Budgeted"}
                </span>
                <BudgetAmount
                  key={year + ":" + month + ":" + item.category_id}
                  item={item}
                  year={year}
                  month={month}
                />
              </div>
              <div className="flex flex-col items-end justify-between gap-1 md:block md:text-right">
                <span className="text-xs text-muted-foreground md:hidden">
                  {income ? "Actual" : "Spent"}
                </span>
                <div>
                  <button
                    className="min-h-10 rounded px-2 text-right tabular-nums hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
                    onClick={() => openActivity(item)}
                  >
                    {money(item.actual_spent)}
                  </button>
                  {item.pending_spent !== 0 ? (
                    <button
                      className="block w-full text-right text-[11px] text-muted-foreground underline underline-offset-2"
                      onClick={() => openActivity(item, "pending")}
                    >
                      {money(item.pending_spent)} pending
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-col items-end justify-between gap-1 md:block md:text-right">
                <span className="text-xs text-muted-foreground md:hidden">
                  {income ? "Still to earn" : "Remaining"}
                </span>
                <div>
                  <p
                    className={cn(
                      "font-medium tabular-nums",
                      overspent ? "text-destructive" : "text-foreground",
                    )}
                  >
                    {money(remaining)}
                  </p>
                  {overspent ? (
                    <p className="text-[11px] text-destructive">Over budget</p>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
export default function BudgetPage() {
  return (
    <Suspense fallback={<p role="status">Loading budget…</p>}>
      <BudgetContent />
    </Suspense>
  );
}
