"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlaidLink, type PlaidLinkOnSuccess } from "react-plaid-link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2, RefreshCw, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getBankConnections } from "@/lib/queries/accounts";

export function PlaidConnectionCleanup() {
  const queryClient = useQueryClient();
  const [repairingConnectionId, setRepairingConnectionId] = useState<
    string | null
  >(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const { data: connections = [] } = useQuery({
    queryKey: ["bank-connections"],
    queryFn: getBankConnections,
  });
  const inactiveConnections = connections.filter(
    (connection) => connection.status === "inactive"
  );
  const errorConnections = connections.filter(
    (connection) => connection.status === "error"
  );

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["bank-connections"] });
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["uncategorized-count"] });
    queryClient.invalidateQueries({ queryKey: ["budget"] });
  }, [queryClient]);

  const finishRepair = useCallback(async () => {
    if (!repairingConnectionId) {
      throw new Error("Plaid connection repair session was lost");
    }

    const response = await fetch(
      `/api/plaid/connections/${repairingConnectionId}/sync`,
      { method: "POST" }
    );
    const json = (await response.json().catch(() => ({}))) as {
      accounts?: number;
      transactions?: number;
      error?: string;
    };
    if (!response.ok) {
      throw new Error(json.error || "Plaid reconnected but could not sync");
    }

    toast.success(
      `Plaid reconnected and synced ${json.accounts ?? 0} accounts and ${json.transactions ?? 0} transactions`
    );
    setLinkToken(null);
    setRepairingConnectionId(null);
    invalidate();
  }, [invalidate, repairingConnectionId]);

  const onRepairSuccess = useCallback<PlaidLinkOnSuccess>(async () => {
    try {
      await finishRepair();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to finish Plaid repair"
      );
      invalidate();
    }
  }, [finishRepair, invalidate]);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: onRepairSuccess,
    onExit: () => {
      setLinkToken(null);
      setRepairingConnectionId(null);
    },
  });

  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, open, ready]);

  const repairMutation = useMutation({
    mutationFn: async (connectionId: string) => {
      const response = await fetch(
        `/api/plaid/connections/${connectionId}/link-token`,
        { method: "POST" }
      );
      const json = (await response.json().catch(() => ({}))) as {
        link_token?: string;
        error?: string;
      };
      if (!response.ok || !json.link_token) {
        throw new Error(json.error || "Failed to start Plaid reconnection");
      }
      return { connectionId, linkToken: json.link_token };
    },
    onMutate: (connectionId) => {
      setRepairingConnectionId(connectionId);
    },
    onSuccess: ({ connectionId, linkToken: nextToken }) => {
      setRepairingConnectionId(connectionId);
      setLinkToken(nextToken);
    },
    onError: (error: Error) => {
      setRepairingConnectionId(null);
      setLinkToken(null);
      toast.error(error.message);
    },
  });

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

  if (inactiveConnections.length === 0 && errorConnections.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {errorConnections.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 text-red-700" />
            <div>
              <p className="text-sm font-medium text-red-950">
                Bank connections need attention
              </p>
              <p className="mt-1 text-xs text-red-800">
                Reconnect each bank below to resume automatic transaction sync.
              </p>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {errorConnections.map((connection) => (
              <div
                key={connection.id}
                className="flex items-center justify-between gap-3 rounded-md border border-red-200 bg-white/70 p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-red-950">
                    {connection.institution_name ?? "Plaid connection"}
                  </p>
                  <p className="mt-0.5 text-xs text-red-800">
                    {connection.error_message &&
                    connection.error_message !== "[object Object]"
                      ? connection.error_message
                      : "Plaid requires this connection to be refreshed."}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={repairMutation.isPending || Boolean(linkToken)}
                  onClick={() => repairMutation.mutate(connection.id)}
                >
                  {repairMutation.isPending &&
                  repairingConnectionId === connection.id ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1 h-4 w-4" />
                  )}
                  Reconnect
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {inactiveConnections.length > 0 && (
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
      )}
    </div>
  );
}
