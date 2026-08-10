"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileSearch, Link2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";

type Candidate = { id: string; date: string; amount: number; description: string; source?: string; connectionProvider?: string };
type Review = {
  id: string; review_type: string; account_name: string | null; amount: number; description: string;
  transaction_date: string; posted_date: string | null; proposed_date: string; statement_file: string;
  statement_period_start: string | null; statement_period_end: string | null; page: number | null;
  row_reference: string | null; reason: string | null; candidates: Candidate[]; risk_flags: string[];
};
type ResponseData = { items: Review[]; count: number; page: number; pageSize: number; summary: {
  total: number; reviewed: number; totalQueue: number; amount: number; byType: Record<string, number>; years: string[]; accounts: string[];
} };

const labels: Record<string, string> = {
  proposed_import: "Missing", possible_match: "Possible match", conflict: "Conflict", likely_duplicate: "Likely duplicate",
};
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || "Request failed");
  return json;
}

export default function StatementReconciliationPage() {
  const queryClient = useQueryClient();
  const [type, setType] = useState("all");
  const [year, setYear] = useState("all");
  const [account, setAccount] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedCandidate, setSelectedCandidate] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const queryString = useMemo(() => new URLSearchParams({ type, year, account, page: String(page) }).toString(), [type, year, account, page]);
  const { data, isLoading, error } = useQuery<ResponseData>({
    queryKey: ["statement-reconciliation", type, year, account, page],
    queryFn: () => requestJson(`/api/statement-reconciliation?${queryString}`),
  });
  const mutation = useMutation({
    mutationFn: (input: { reviewId: string; decision: string; candidateTransactionId?: string }) => requestJson(
      "/api/statement-reconciliation",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, note }) }
    ),
    onSuccess: async () => {
      setNote("");
      toast.success("Review decision saved");
      await queryClient.invalidateQueries({ queryKey: ["statement-reconciliation"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save decision"),
  });
  const item = data?.items[0];
  const completed = data?.summary.reviewed ?? 0;
  const filterChanged = (setter: (value: string) => void) => (event: React.ChangeEvent<HTMLSelectElement>) => { setter(event.target.value); setPage(1); };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-8">
      <div>
        <div className="flex items-center gap-2"><FileSearch className="h-6 w-6 text-emerald-600" /><h1 className="text-2xl font-semibold">Statement reconciliation</h1></div>
        <p className="mt-1 text-sm text-muted-foreground">Review the remaining ambiguous and missing statement transactions. Nothing is deleted or overwritten.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries(labels).map(([key, label]) => <Card key={key}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-semibold">{data?.summary.byType[key] ?? "—"}</p></CardContent></Card>)}
      </div>

      <Card><CardContent className="space-y-2 p-4"><div className="flex justify-between text-sm"><span>{data?.summary.total ?? 0} pending</span><span>{completed} reviewed</span></div><Progress value={data?.summary.totalQueue ? (completed / data.summary.totalQueue) * 100 : 100} /></CardContent></Card>

      <div className="flex flex-wrap gap-2">
        <select aria-label="Review type" value={type} onChange={filterChanged(setType)} className="h-9 rounded-lg border bg-background px-3 text-sm"><option value="all">All review types</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        <select aria-label="Year" value={year} onChange={filterChanged(setYear)} className="h-9 rounded-lg border bg-background px-3 text-sm"><option value="all">All years</option>{data?.summary.years.map((value) => <option key={value}>{value}</option>)}</select>
        <select aria-label="Account" value={account} onChange={filterChanged(setAccount)} className="h-9 max-w-xs rounded-lg border bg-background px-3 text-sm"><option value="all">All accounts</option>{data?.summary.accounts.map((value) => <option key={value}>{value}</option>)}</select>
      </div>

      {isLoading && <Card><CardContent className="p-8 text-center text-muted-foreground">Loading review queue…</CardContent></Card>}
      {error && <Card><CardContent className="p-8 text-center text-destructive">{error.message}</CardContent></Card>}
      {!isLoading && !error && !item && <Card><CardContent className="flex flex-col items-center gap-2 p-10 text-center"><CheckCircle2 className="h-10 w-10 text-emerald-600" /><h2 className="font-semibold">No reviews in this view</h2><p className="text-sm text-muted-foreground">When the entire queue is complete, this tab disappears from navigation.</p></CardContent></Card>}

      {item && <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><div className="flex items-center justify-between gap-2"><CardTitle>Statement record</CardTitle><Badge variant={item.review_type === "conflict" ? "destructive" : "secondary"}>{labels[item.review_type]}</Badge></div></CardHeader>
          <CardContent className="space-y-4">
            <div><p className="text-2xl font-semibold tabular-nums">{money.format(item.amount)}</p><p className="font-medium">{item.description}</p></div>
            <dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-muted-foreground">Account</dt><dd>{item.account_name}</dd></div><div><dt className="text-muted-foreground">Date used</dt><dd>{item.proposed_date}</dd></div><div><dt className="text-muted-foreground">Transaction date</dt><dd>{item.transaction_date}</dd></div><div><dt className="text-muted-foreground">Posted date</dt><dd>{item.posted_date ?? "Not provided"}</dd></div></dl>
            <div className="rounded-lg bg-muted p-3 text-xs"><p className="font-medium">{item.statement_file}</p><p className="mt-1 text-muted-foreground">{item.row_reference ?? (item.page ? `Page ${item.page}` : "No page reference")}</p></div>
            {item.reason && <div className="flex gap-2 text-sm text-amber-700 dark:text-amber-400"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p>{item.reason}</p></div>}
            {item.risk_flags.length > 0 && <div className="flex flex-wrap gap-1">{item.risk_flags.map((flag) => <Badge key={flag} variant="outline">{flag.replaceAll("_", " ")}</Badge>)}</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Existing transaction candidates</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {item.candidates.length === 0 ? <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">No existing candidates were found.</p> : item.candidates.map((candidate) => (
              <label key={candidate.id} className="flex cursor-pointer gap-3 rounded-lg border p-3 has-[:checked]:border-emerald-600 has-[:checked]:bg-emerald-50 dark:has-[:checked]:bg-emerald-950/20">
                <input type="radio" name={`candidate-${item.id}`} value={candidate.id} checked={selectedCandidate[item.id] === candidate.id} onChange={() => setSelectedCandidate((current) => ({ ...current, [item.id]: candidate.id }))} />
                <div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><span className="font-medium">{candidate.description}</span><span className="tabular-nums">{money.format(candidate.amount)}</span></div><p className="text-xs text-muted-foreground">{candidate.date} · {candidate.source ?? candidate.connectionProvider ?? "existing"}</p></div>
              </label>
            ))}
            <Textarea placeholder="Optional review note" value={note} onChange={(event) => setNote(event.target.value)} />
            <div className="grid gap-2 sm:grid-cols-2">
              <Button disabled={!selectedCandidate[item.id] || mutation.isPending} onClick={() => mutation.mutate({ reviewId: item.id, decision: "matched", candidateTransactionId: selectedCandidate[item.id] })}><Link2 />Match selected</Button>
              <Button variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate({ reviewId: item.id, decision: "imported" })}><Upload />Import statement record</Button>
              <Button variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate({ reviewId: item.id, decision: "legitimate_duplicate" })}>Keep as legitimate duplicate</Button>
              <Button variant="ghost" disabled={mutation.isPending} onClick={() => mutation.mutate({ reviewId: item.id, decision: "ignored" })}>Ignore statement record</Button>
            </div>
          </CardContent>
        </Card>
      </div>}

      {data && data.count > data.pageSize && <div className="flex items-center justify-between"><Button variant="outline" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><span className="text-sm text-muted-foreground">Page {page} of {Math.ceil(data.count / data.pageSize)}</span><Button variant="outline" disabled={page >= Math.ceil(data.count / data.pageSize)} onClick={() => setPage((value) => value + 1)}>Next</Button></div>}
    </div>
  );
}
