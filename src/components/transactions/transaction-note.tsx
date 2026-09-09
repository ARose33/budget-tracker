"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getTransactionNote, updateTransactionNotes, type NoteState } from "@/lib/queries/transactions";
import { saveError } from "@/lib/finance/cache";
import { TransactionHistory } from "./transaction-history";
export function TransactionNote({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  return <div className="space-y-3 border-t pt-4"><Button variant="outline" size="sm" onClick={() => setOpen(!open)}>{open ? "Hide note" : "Open note"}</Button>{open ? <LoadedNote id={id} /> : null}</div>;
}
function LoadedNote({ id }: { id: string }) {
  const query = useQuery({ queryKey: ["transaction-note", id], queryFn: () => getTransactionNote(id), staleTime: 0 });
  if (query.isPending) return <p role="status">Loading note…</p>;
  if (query.isError) return <p role="alert">{saveError(query.error)} <Button variant="outline" onClick={() => query.refetch()}>Retry</Button></p>;
  return <NoteFields key={id} id={id} latest={query.data} />;
}
function NoteFields({ id, latest }: { id: string; latest: NoteState }) {
  const [original, setOriginal] = useState(latest);
  const client = useQueryClient();
  const [draft, setDraft] = useState(original.content);
  const mutation = useMutation({
    mutationFn: () => updateTransactionNotes(id, draft, original),
    onSuccess: async (saved) => { setOriginal(saved); setDraft(saved.content); await client.invalidateQueries({ queryKey: ["transaction-note", id] }); await client.invalidateQueries({ queryKey: ["transaction-history", id] }); },
  });
  return <form className="space-y-2" onSubmit={event => { event.preventDefault(); mutation.mutate(); }}>
    <label className="grid gap-2 text-sm">Private note<Textarea value={draft} maxLength={2000} disabled={mutation.isPending} onChange={event => setDraft(event.target.value)} /></label>
    <p className="text-xs text-muted-foreground">Previous versions are retained when a note is edited or cleared.</p>
    {latest.hash !== original.hash || latest.version !== original.version ? <p role="alert" className="text-sm text-destructive">A newer note is available. Your draft is retained. Close and reopen the note to review it.</p> : null}
    {mutation.isError ? <p role="alert" className="text-sm text-destructive">{saveError(mutation.error)}</p> : null}
    {mutation.isSuccess ? <p role="status" className="text-sm">Note saved.</p> : null}
    <Button size="sm" type="submit" disabled={mutation.isPending || draft === original.content}>{mutation.isPending ? "Saving…" : "Save note"}</Button>
    <TransactionHistory id={id} kind="notes" />
  </form>;
}
