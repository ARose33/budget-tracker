"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { getProviderReviews, resolveProviderReview, type ProviderReview } from "@/lib/queries/provider-reviews";
import { getAccounts } from "@/lib/queries/accounts";
import { money } from "@/lib/finance/format";
import { invalidateFinance, saveError } from "@/lib/finance/cache";
export function ProviderReviews() {
  const [status, setStatus] = useState("pending");
  const [page, setPage] = useState(0);
  const query = useQuery({ queryKey: ["provider-reviews", status, page], queryFn: () => getProviderReviews(status, page) });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: getAccounts });
  const names = Object.fromEntries((accounts.data ?? []).map(account => [account.id, account.name]));
  return <section className="space-y-4 rounded-xl border bg-card p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Bank update review</h2><label className="text-sm"><span className="sr-only">Bank review status</span><select className="min-h-10 rounded border bg-card px-2" value={status} onChange={event => { setStatus(event.target.value); setPage(0); }}><option value="pending">Needs review</option><option value="accepted">Accepted history</option><option value="kept">Kept history</option></select></label></div>
    <p className="text-xs text-muted-foreground">Manual and historical values are preserved when bank updates conflict. Possible matches are never merged automatically.</p>
    {query.isPending ? <p role="status">Loading bank updates…</p> : query.isError ? <div role="alert">{saveError(query.error)}<Button variant="outline" onClick={() => query.refetch()}>Retry</Button></div> : <>
      {!query.data.count ? <p className="text-sm text-muted-foreground">{status === "pending" ? "No bank updates need your review." : "No decisions in this history yet."}</p> : null}
      {query.data.rows.map(review => <Review key={review.id} review={review} names={names} />)}
      {query.data.count > 20 ? <div className="flex justify-between gap-2"><Button variant="outline" disabled={!page} onClick={() => setPage(page - 1)}>Previous</Button><span className="text-xs">{page + 1} / {Math.ceil(query.data.count / 20)}</span><Button variant="outline" disabled={(page + 1) * 20 >= query.data.count} onClick={() => setPage(page + 1)}>Next</Button></div> : null}
    </>}
  </section>;
}
function Review({ review, names }: { review: ProviderReview; names: Record<string, string> }) {
  const client = useQueryClient();
  const mutation = useMutation({ mutationFn: (decision: "accept" | "keep") => resolveProviderReview(review, decision), onSuccess: () => invalidateFinance(client) });
  const proposed = review.proposed_values;
  const bankBalance = review.entity_type === "account";
  const label = bankBalance ? "Use bank balance" : review.entity_id ? "Accept these values" : "Add as separate transaction";
  return <article className="space-y-3 rounded-lg border p-4">
    <h3 className="text-sm font-medium">{bankBalance ? "Account balance" : proposed.description || "Bank transaction"}</h3>
    <p className="text-xs text-muted-foreground">{review.reason}</p>
    <div className="grid gap-3 text-sm sm:grid-cols-2">{[[review.status === "pending" ? "Current" : "Preserved earlier values", review.status === "pending" ? review.current : review.existing_values], ["Bank update", proposed]].map(([label, raw]) => {
      const value = typeof raw === "object" ? raw : null;
      return <div key={String(label)} className="rounded bg-muted/35 p-3"><p className="mb-1 text-xs font-semibold text-muted-foreground">{String(label)}</p>{!value ? <p>No linked transaction</p> : bankBalance ? <p>{value.current_balance == null ? "Unavailable" : money(value.current_balance)}</p> : <><p>{value.description}</p><p>{value.date} · {money(value.amount ?? 0)}</p><p className="text-xs">{value.account_id ? names[value.account_id] ?? "Historical account" : "No account"}</p></>}</div>;
    })}</div>
    {review.candidates.length ? <details><summary className="cursor-pointer text-xs font-medium">Possible existing activity ({review.candidates.length} shown)</summary><ul className="mt-2 space-y-2 text-xs">{review.candidates.map(candidate => <li key={candidate.id}>{candidate.date} · {candidate.description} · {money(candidate.amount)}</li>)}</ul></details> : null}
    {bankBalance ? <p className="text-xs text-muted-foreground">Using the bank balance also enables future bank balance updates for this account.</p> : null}
    {review.status === "pending" ? <div className="flex flex-wrap gap-2"><Button size="sm" disabled={mutation.isPending} onClick={() => { if (window.confirm(label + "? Review the current and proposed values above. Existing history will be retained.")) mutation.mutate("accept"); }}>{label}</Button><Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate("keep")}>Keep current ledger</Button></div> : <p className="text-xs font-medium">Decision: {review.status}</p>}
    {mutation.isError ? <p role="alert" className="text-sm text-destructive">{saveError(mutation.error)}</p> : null}
  </article>;
}
