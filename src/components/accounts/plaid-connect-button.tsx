"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlaidLink, type PlaidLinkOnSuccess } from "react-plaid-link";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Landmark, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface PlaidHealth {
  environment: string;
  hasClientId: boolean;
  hasSecret: boolean;
  hasServiceRoleKey: boolean;
  ready: boolean;
}

type Summary = {
  accounts?: number;
  transactions?: number;
  duplicatesLinked?: number;
};

async function readJsonResponse<T extends object>(response: Response): Promise<T> {
  const json = (await response.json().catch(() => ({}))) as
    | T
    | { error?: string };
  if (!response.ok) {
    throw new Error(
      "error" in json && json.error ? json.error : "Request failed"
    );
  }
  return json as T;
}

function getPlaidHealthMessage(health: PlaidHealth) {
  if (!health.hasClientId) {
    return "Set PLAID_CLIENT_ID to enable Plaid Link.";
  }
  if (!health.hasSecret) {
    return "Set PLAID_SECRET to enable Plaid API calls.";
  }
  if (!health.hasServiceRoleKey) {
    return "Set SUPABASE_SERVICE_ROLE_KEY so Plaid can save bank data.";
  }
  return null;
}

function syncToast(summary: Summary) {
  const linked = summary.duplicatesLinked ?? 0;
  const duplicateText =
    linked > 0 ? ` and linked ${linked} existing duplicates` : "";
  toast.success(
    `Plaid synced ${summary.accounts ?? 0} accounts and ${summary.transactions ?? 0} transactions${duplicateText}`
  );
}

export function PlaidConnectButton() {
  const queryClient = useQueryClient();
  const [health, setHealth] = useState<PlaidHealth | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLoadingToken, setIsLoadingToken] = useState(false);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
    queryClient.invalidateQueries({ queryKey: ["bank-connections"] });
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["uncategorized-count"] });
    queryClient.invalidateQueries({ queryKey: ["budget"] });
  }, [queryClient]);

  useEffect(() => {
    let cancelled = false;

    async function loadHealth() {
      try {
        const response = await fetch("/api/plaid/health");
        const nextHealth = await readJsonResponse<PlaidHealth>(response);
        if (!cancelled) {
          setHealth(nextHealth);
        }
      } catch {
        if (!cancelled) {
          setHealth(null);
        }
      }
    }

    loadHealth();

    return () => {
      cancelled = true;
    };
  }, []);

  const onSuccess = useCallback<PlaidLinkOnSuccess>(
    async (publicToken, metadata) => {
      setIsConnecting(true);
      try {
        const response = await fetch("/api/plaid/exchange-public-token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            public_token: publicToken,
            metadata,
          }),
        });
        const summary = await readJsonResponse<Summary>(response);
        syncToast(summary);
        invalidate();
        setLinkToken(null);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to save Plaid item"
        );
      } finally {
        setIsConnecting(false);
      }
    },
    [invalidate]
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit: () => setIsConnecting(false),
  });

  useEffect(() => {
    if (linkToken && ready) {
      open();
    }
  }, [linkToken, open, ready]);

  const handleConnect = async () => {
    setIsConnecting(true);
    setIsLoadingToken(true);
    try {
      const healthResponse = await fetch("/api/plaid/health");
      const latestHealth = await readJsonResponse<PlaidHealth>(healthResponse);
      setHealth(latestHealth);
      const healthMessage = getPlaidHealthMessage(latestHealth);
      if (healthMessage) {
        throw new Error(healthMessage);
      }

      const tokenResponse = await fetch("/api/plaid/link-token", {
        method: "POST",
      });
      const token = await readJsonResponse<{ link_token: string }>(
        tokenResponse
      );
      setLinkToken(token.link_token);
    } catch (error) {
      setIsConnecting(false);
      toast.error(
        error instanceof Error ? error.message : "Failed to start Plaid"
      );
    } finally {
      setIsLoadingToken(false);
    }
  };

  const healthMessage = health ? getPlaidHealthMessage(health) : null;
  const buttonDisabled = isConnecting || isLoadingToken;
  const buttonLabel = isConnecting
    ? isLoadingToken
      ? "Loading Plaid"
      : "Connecting"
    : healthMessage
      ? "Setup Plaid"
      : "Connect Plaid";

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleConnect}
      disabled={buttonDisabled}
      title={healthMessage ?? undefined}
    >
      {isConnecting ? (
        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
      ) : healthMessage ? (
        <AlertCircle className="h-4 w-4 mr-1" />
      ) : (
        <Landmark className="h-4 w-4 mr-1" />
      )}
      {buttonLabel}
    </Button>
  );
}
