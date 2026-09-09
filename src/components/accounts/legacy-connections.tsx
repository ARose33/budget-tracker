"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
const bank = z.object({
  id: z.string(),
  institution_name: z.string().nullable(),
  provider: z.string(),
  status: z.string(),
  last_synced_at: z.string().nullable(),
});
const legacy = z.object({
  id: z.string(),
  institution_name: z.string().nullable(),
  created_at: z.string().nullable(),
});
export function LegacyConnections() {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ["legacy-connections"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "stackmint_legacy_connections",
        {},
      );
      if (error) throw new Error("Connection history could not be loaded");
      return z
        .object({ bank: z.array(bank), legacy: z.array(legacy) })
        .parse(data);
    },
  });
  return (
    <section className="space-y-3">
      <Button variant="outline" onClick={() => setOpen(!open)}>
        {open ? "Hide" : "Show"} earlier connection history
      </Button>
      {open && (
        <div className="space-y-2 rounded-lg border p-4 text-sm">
          <p className="text-muted-foreground">
            Retained metadata from earlier integrations. These records do not
            establish whether the provider connection is still active.
          </p>
          {query.isPending && <p role="status">Loading connection history…</p>}
          {query.isError && (
            <p role="alert">
              {query.error.message}{" "}
              <Button variant="outline" onClick={() => query.refetch()}>
                Retry
              </Button>
            </p>
          )}
          {query.data?.bank.map((row) => (
            <p key={row.id}>
              {row.institution_name ?? "Historical institution"} ·{" "}
              {row.provider} · recorded status: {row.status}
            </p>
          ))}
          {query.data?.legacy.map((row) => (
            <p key={row.id}>
              {row.institution_name ?? "Historical institution"} · earlier Plaid
              record
              {row.created_at
                ? " · " + new Date(row.created_at).toLocaleDateString()
                : ""}
            </p>
          ))}
          {query.data &&
            !query.data.bank.length &&
            !query.data.legacy.length && (
              <p>No earlier connection metadata was found.</p>
            )}
        </div>
      )}
    </section>
  );
}
