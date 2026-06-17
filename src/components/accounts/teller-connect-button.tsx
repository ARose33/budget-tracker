"use client";

import { useEffect, useState } from "react";
import Script from "next/script";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Landmark, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface TellerConnectConfig {
  applicationId: string;
  environment: string;
  nonce: string;
  products: string[];
  selectAccount: string;
}

interface TellerHealth {
  environment: string;
  hasApplicationId: boolean;
  hasCertificate: boolean;
  hasPrivateKey: boolean;
  hasServiceRoleKey: boolean;
  mtlsRequired: boolean;
  ready: boolean;
}

interface TellerEnrollment {
  accessToken: string;
  user?: {
    id?: string;
  };
  enrollment: {
    id: string;
    institution?: {
      name?: string;
    };
  };
  signatures?: string[];
  environment?: string;
}

interface TellerConnectInstance {
  open: () => void;
}

interface TellerConnectGlobal {
  setup: (config: {
    applicationId: string;
    environment: string;
    nonce: string;
    products: string[];
    selectAccount: string;
    onSuccess: (enrollment: TellerEnrollment) => void;
    onExit: () => void;
  }) => TellerConnectInstance;
}

type ScriptStatus = "loading" | "ready" | "error";

declare global {
  interface Window {
    TellerConnect?: TellerConnectGlobal;
  }
}

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

function getTellerHealthMessage(health: TellerHealth) {
  if (!health.hasApplicationId) {
    return "Set TELLER_APPLICATION_ID to enable Teller Connect.";
  }
  if (!health.hasServiceRoleKey) {
    return "Set SUPABASE_SERVICE_ROLE_KEY so Teller can save bank connections.";
  }
  if (health.mtlsRequired && (!health.hasCertificate || !health.hasPrivateKey)) {
    return "Set TELLER_CERTIFICATE and TELLER_PRIVATE_KEY for this Teller environment.";
  }
  return null;
}

export function TellerConnectButton() {
  const queryClient = useQueryClient();
  const [scriptStatus, setScriptStatus] = useState<ScriptStatus>("loading");
  const [health, setHealth] = useState<TellerHealth | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadHealth() {
      try {
        const response = await fetch("/api/teller/health");
        const nextHealth = await readJsonResponse<TellerHealth>(response);
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

  const handleConnect = async () => {
    if (scriptStatus === "error") {
      toast.error(
        "Teller Connect failed to load. Check your network, browser extensions, or content blockers, then reload the page."
      );
      return;
    }

    if (!window.TellerConnect || scriptStatus !== "ready") {
      toast.error("Teller Connect is still loading");
      return;
    }

    setIsConnecting(true);
    try {
      const healthResponse = await fetch("/api/teller/health");
      const latestHealth = await readJsonResponse<TellerHealth>(healthResponse);
      setHealth(latestHealth);
      const healthMessage = getTellerHealthMessage(latestHealth);
      if (healthMessage) {
        throw new Error(healthMessage);
      }

      const configResponse = await fetch("/api/teller/connect-config");
      const config = await readJsonResponse<TellerConnectConfig>(
        configResponse
      );

      const tellerConnect = window.TellerConnect.setup({
        ...config,
        onSuccess: async (enrollment) => {
          try {
            const response = await fetch("/api/teller/enrollments", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(enrollment),
            });
            const summary = await readJsonResponse<{
              accounts: number;
              transactions: number;
            }>(response);

            toast.success(
              `Teller synced ${summary.accounts} accounts and ${summary.transactions} transactions`
            );
            queryClient.invalidateQueries({ queryKey: ["accounts"] });
            queryClient.invalidateQueries({ queryKey: ["transactions"] });
            queryClient.invalidateQueries({ queryKey: ["budget"] });
          } catch (error) {
            toast.error(
              error instanceof Error
                ? error.message
                : "Failed to save Teller enrollment"
            );
          } finally {
            setIsConnecting(false);
          }
        },
        onExit: () => {
          setIsConnecting(false);
        },
      });

      tellerConnect.open();
    } catch (error) {
      setIsConnecting(false);
      toast.error(
        error instanceof Error ? error.message : "Failed to start Teller"
      );
    }
  };

  const healthMessage = health ? getTellerHealthMessage(health) : null;
  const buttonDisabled = scriptStatus === "loading" || isConnecting;
  const buttonLabel = isConnecting
    ? "Connecting"
    : scriptStatus === "loading"
      ? "Loading Teller"
      : scriptStatus === "error"
        ? "Teller unavailable"
        : healthMessage
          ? "Setup Teller"
          : "Connect Teller";

  return (
    <>
      <Script
        src="https://cdn.teller.io/connect/connect.js"
        strategy="afterInteractive"
        onLoad={() => setScriptStatus("ready")}
        onError={() => setScriptStatus("error")}
      />
      <Button
        size="sm"
        variant="outline"
        onClick={handleConnect}
        disabled={buttonDisabled}
        title={
          scriptStatus === "error"
            ? "Teller Connect script failed to load"
            : healthMessage ?? undefined
        }
      >
        {isConnecting ? (
          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
        ) : scriptStatus === "error" || healthMessage ? (
          <AlertCircle className="h-4 w-4 mr-1" />
        ) : (
          <Landmark className="h-4 w-4 mr-1" />
        )}
        {buttonLabel}
      </Button>
    </>
  );
}
