"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getBankConnections } from "@/lib/queries/accounts";

export function PlaidConnectionCleanup() {
  const queryClient = useQueryClient();
  const { data: connections = [] } = useQuery({
    queryKey: ["bank-connections"],
    queryFn: getBankConnections,
  });
  const inactiveConnections = connections.filter(
    (connection) => connection.status === "inactive"
  );

  const removeMutation = useMutation({
    mutationFn: async (connectionId: string) => {
      const response = await fetch(
        `/api/plaid/connections/${connectionId}`,
        { method: "DELETE" }
      );
      const json = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(json.error || "Failed to remove Plaid connection");
      }
    },
    onSuccess: () => {
      toast.success("Retired Plaid connection removed");
      queryClient.invalidateQueries({ queryKey: ["bank-connections"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  if (inactiveConnections.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <p className="text-sm font-medium text-amber-950">
        Retired Plaid connections
      </p>
      <div className="mt-3 space-y-2">
        {inactiveConnections.map((connection) => (
          <div
            key={connection.id}
            className="flex items-center justify-between gap-3"
          >
            <div>
              <p className="text-sm text-amber-950">
                {connection.institution_name ?? "Plaid connection"}
              </p>
              <p className="text-xs text-amber-800">
                Connection {connection.id.slice(0, 8)}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={removeMutation.isPending}
              onClick={() => removeMutation.mutate(connection.id)}
            >
              {removeMutation.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Unplug className="mr-1 h-4 w-4" />
              )}
              Remove from Plaid
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
