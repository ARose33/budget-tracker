"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getTransaction,
  editTransactions,
  observedVersion,
  type Transaction,
} from "@/lib/queries/transactions";
import { CategorySelect } from "./category-select";
import { AccountSelect } from "./account-select";
import { SplitTransactionDialog } from "./split-transaction-dialog";
import { invalidateFinance, saveError } from "@/lib/finance/cache";
import { money } from "@/lib/finance/format";
import { TransactionNote } from "./transaction-note";
import { TransactionHistory } from "./transaction-history";
export function TransactionEditor({
  id,
  close,
}: {
  id: string;
  close: () => void;
}) {
  const query = useQuery({
    queryKey: ["transaction", id],
    queryFn: () => getTransaction(id),
    refetchOnMount: "always",
  });
  if (query.isPending || (!query.isFetchedAfterMount && !query.isError))
    return (
      <p role="status" className="p-4">
        Loading transaction…
      </p>
    );
  if (query.isError)
    return (
      <div role="alert" className="p-4">
        {saveError(query.error)}
        <Button variant="outline" onClick={() => query.refetch()}>
          Retry
        </Button>
      </div>
    );
  return <EditorFields key={query.data.id} latest={query.data} close={close} />;
}
function EditorFields({
  latest,
  close,
}: {
  latest: Transaction;
  close: () => void;
}) {
  const [transaction] = useState(latest);
  const client = useQueryClient();
  const [description, setDescription] = useState(transaction.description ?? "");
  const [date, setDate] = useState(transaction.date);
  const [category, setCategory] = useState(transaction.category_id);
  const [account, setAccount] = useState(transaction.account_id);
  const mutation = useMutation({
    mutationFn: () =>
      editTransactions([observedVersion(transaction)], {
        ...(description !== (transaction.description ?? "")
          ? { description }
          : {}),
        ...(date !== transaction.date ? { date } : {}),
        ...(account && account !== transaction.account_id
          ? { account_id: account }
          : {}),
        ...(!transaction.is_split && category !== transaction.category_id
          ? {
              category_id: category,
              categorization_status: category ? "final" : "uncategorized",
            }
          : {}),
      }),
    onSuccess: async () => {
      await invalidateFinance(client);
      close();
    },
  });
  const review = useMutation({
    mutationFn: () =>
      editTransactions([observedVersion(transaction)], {
        categorization_status: "final",
      }),
    onSuccess: async () => {
      await invalidateFinance(client);
      close();
    },
  });
  const restore = useMutation({
    mutationFn: () =>
      editTransactions([observedVersion(transaction)], { archived: false }),
    onSuccess: async () => {
      await invalidateFinance(client);
      close();
    },
  });
  const dirty =
    description !== (transaction.description ?? "") ||
    date !== transaction.date ||
    category !== transaction.category_id ||
    account !== transaction.account_id;
  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      {latest.row_version !== transaction.row_version ? (
        <p role="alert" className="text-sm text-destructive">
          This transaction changed while you were editing. Your draft is
          retained. Close and reopen to review the latest version.
        </p>
      ) : null}
      <div className="flex justify-between gap-3">
        <h3 className="font-semibold">Transaction details</h3>
        <span className="font-medium tabular-nums">
          {money(transaction.amount)}
        </span>
      </div>
      {transaction.external_status === "pending" ? (
        <p className="text-sm">
          Pending at the bank. Excluded from posted budget totals.
        </p>
      ) : null}
      {transaction.archived_at || transaction.external_status === "removed" ? (
        <p className="text-sm">
          Historical transaction · excluded from active totals.
        </p>
      ) : null}
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (dirty) mutation.mutate();
        }}
      >
        <fieldset
          disabled={mutation.isPending || review.isPending}
          className="space-y-4"
        >
          <label className="grid gap-2 text-sm">
            Description
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={5000}
            />
          </label>
          <label className="grid gap-2 text-sm">
            Date
            <Input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
            />
          </label>
          <div className="grid gap-2 text-sm">
            <span>Account</span>
            <AccountSelect
              value={account}
              onValueChange={setAccount}
              className="w-full"
            />
          </div>
          {!transaction.is_split ? (
            <div className="grid gap-2 text-sm">
              <span>Category</span>
              <CategorySelect
                value={category}
                onValueChange={setCategory}
                className="w-full"
              />
            </div>
          ) : (
            <p className="text-sm">
              Split into {transaction.allocations.length} allocations. Edit the
              split to change its categories.
            </p>
          )}
        </fieldset>
        {mutation.isError || review.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {saveError(mutation.error ?? review.error)}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            disabled={!dirty || mutation.isPending || review.isPending}
          >
            {mutation.isPending ? "Saving…" : "Save changes"}
          </Button>
          <Button
            variant="outline"
            onClick={close}
            disabled={mutation.isPending}
          >
            Close
          </Button>
          {!transaction.archived_at &&
          transaction.external_status !== "removed" &&
          !dirty ? (
            <SplitTransactionDialog
              transaction={transaction}
              onSaved={() => {
                void invalidateFinance(client);
                close();
              }}
            />
          ) : null}
          {transaction.categorization_status === "pending" ? (
            <Button
              variant="outline"
              disabled={dirty || review.isPending || mutation.isPending}
              onClick={() => review.mutate()}
            >
              Confirm category
            </Button>
          ) : null}
        </div>
      </form>
      <TransactionNote id={transaction.id} />
      <TransactionHistory id={transaction.id} kind="changes" />
      {transaction.archived_at ? (
        <div>
          <Button
            variant="outline"
            disabled={restore.isPending || dirty}
            onClick={() => restore.mutate()}
          >
            {restore.isPending ? "Restoring…" : "Restore from archive"}
          </Button>
          {restore.isError ? (
            <p role="alert">{saveError(restore.error)}</p>
          ) : null}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Source:{" "}
        {transaction.upload_source || transaction.source || "Historical entry"}{" "}
        ·{" "}
        {transaction.plaid_transaction_id
          ? "Bank connection"
          : "No bank transaction identifier"}
      </p>
    </div>
  );
}
