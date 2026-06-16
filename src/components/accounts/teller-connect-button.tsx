"use client";

import { useState } from "react";
import Script from "next/script";
import { useQueryClient } from "@tanstack/react-query";
import { Landmark, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface TellerConnectConfig {
  applicationId: string;
  environment: string;
  nonce: string;
  products: string[];
  selectAccount: string;
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

declare global {
  interface Window {
    TellerConnect?: TellerConnectGlobal;
  }
}

async function readJsonResponse<T extends object>(response: Response): Promise<T> {
  const json = (await response.json()) as T | { error?: string };
  if (!response.ok) {
    throw new Error(
      "error" in json && json.error ? json.error : "Request failed"
    );
  }
  return json as T;
}

export function TellerConnectButton() {
  const queryClient = useQueryClient();
  const [scriptReady, setScriptReady] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = async () => {
    if (!window.TellerConnect || !scriptReady) {
      toast.error("Teller Connect is still loading");
      return;
    }

    setIsConnecting(true);
    try {
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

  return (
    <>
      <Script
        src="https://cdn.teller.io/connect/connect.js"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
      />
      <Button
        size="sm"
        variant="outline"
        onClick={handleConnect}
        disabled={!scriptReady || isConnecting}
      >
        {isConnecting ? (
          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
        ) : (
          <Landmark className="h-4 w-4 mr-1" />
        )}
        Connect Teller
      </Button>
    </>
  );
}
