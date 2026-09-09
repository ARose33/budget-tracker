"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { saveError } from "@/lib/finance/cache";
import { money } from "@/lib/finance/format";
const fields: Record<string, string> = {
  description: "Description",
  date: "Date",
  amount: "Amount",
  category_id: "Category",
  account_id: "Account",
  archived_at: "Archived",
  is_split: "Split",
  external_status: "Bank status",
  categorization_status: "Review status",
  not_duplicate: "Verified distinct",
};
const note = z.object({
  version: z.number(),
  content: z.string(),
  created_at: z.string(),
});
const change = z.object({
  id: z.string(),
  original_transaction: z.boolean(),
  created_at: z.string(),
  prior_values: z.record(z.string(), z.unknown()).nullable(),
  new_values: z.record(z.string(), z.unknown()),
});
export function TransactionHistory({
  id,
  kind,
}: {
  id: string;
  kind: "changes" | "notes";
}) {
  const [open, setOpen] = useState(false),
    [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["transaction-history", id, kind, page],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "stackmint_transaction_history",
        { p_id: id, p_kind: kind, p_page: page },
      );
      if (error) throw error;
      return z
        .object({
          count: z.number(),
          rows: kind === "notes" ? z.array(note) : z.array(change),
        })
        .parse(data);
    },
  });
  const names = useQuery({
    queryKey: ["history-names"],
    enabled: open && kind === "changes",
    queryFn: async () => {
      const [accounts, categories] = await Promise.all([
        supabase.from("accounts").select("id,name"),
        supabase
          .from("budget_categories")
          .select("id,group_name,line_item_name"),
      ]);
      if (accounts.error || categories.error)
        throw new Error("History labels unavailable");
      return new Map([
        ...(accounts.data ?? []).map((row) => [row.id, row.name] as const),
        ...(categories.data ?? []).map(
          (row) =>
            [row.id, row.group_name + " / " + row.line_item_name] as const,
        ),
      ]);
    },
  });
  function format(key: string, value: unknown) {
    if (value === null || value === undefined) return "None";
    if (key === "amount") return money(Number(value));
    if (key.endsWith("_id"))
      return names.data?.get(String(value)) ?? "Historical reference";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (key === "archived_at") return "Yes";
    return String(value);
  }
  return (
    <div className="space-y-2 border-t pt-3">
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? "Hide" : "Show"}{" "}
        {kind === "notes" ? "note versions" : "change history"}
      </Button>
      {open && (
        <div className="space-y-3 text-sm">
          {query.isPending && <p role="status">Loading history…</p>}
          {query.isError && (
            <p role="alert">
              {saveError(query.error)}{" "}
              <Button
                type="button"
                variant="outline"
                onClick={() => query.refetch()}
              >
                Retry
              </Button>
            </p>
          )}
          {query.data?.count === 0 && (
            <p className="text-muted-foreground">
              {kind === "notes"
                ? "Earlier note versions are retained from the first v2 save."
                : "Change history starts when preservation is enabled; earlier values have not been reconstructed."}
            </p>
          )}
          {query.data?.rows.map((row, index) =>
            "content" in row ? (
              <article key={row.version} className="rounded border p-3">
                <p className="text-xs text-muted-foreground">
                  Version {row.version} ·{" "}
                  {new Date(row.created_at).toLocaleString()}
                </p>
                <p className="mt-2 whitespace-pre-wrap break-words">
                  {row.content || "(Empty note)"}
                </p>
              </article>
            ) : (
              <article key={row.id ?? index} className="rounded border p-3">
                <p className="mb-2 text-xs text-muted-foreground">
                  {row.original_transaction
                    ? "Original transaction"
                    : "Split allocation"}{" "}
                  · {new Date(row.created_at).toLocaleString()}
                </p>
                <dl className="space-y-1">
                  {Object.entries(fields)
                    .filter(
                      ([key]) =>
                        JSON.stringify(row.prior_values?.[key]) !==
                        JSON.stringify(row.new_values[key]),
                    )
                    .map(([key, label]) => (
                      <div
                        key={key}
                        className="grid grid-cols-[6rem_1fr] gap-2"
                      >
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="break-words">
                          {row.prior_values
                            ? format(key, row.prior_values[key]) + " → "
                            : "Created: "}
                          {format(key, row.new_values[key])}
                        </dd>
                      </div>
                    ))}
                </dl>
              </article>
            ),
          )}
          {query.data && query.data.count > 20 && (
            <div className="flex justify-between">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Newer
              </Button>
              <span>
                {page} / {Math.ceil(query.data.count / 20)}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={page * 20 >= query.data.count}
                onClick={() => setPage(page + 1)}
              >
                Older
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
