"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAccounts, getBankConnections } from "@/lib/queries/accounts";
import { useState } from "react";
import Link from "next/link";
import { ProviderReviews } from "@/components/accounts/provider-reviews";
import { LegacyConnections } from "@/components/accounts/legacy-connections";
import { invalidateFinance, saveError } from "@/lib/finance/cache";
import { money } from "@/lib/finance/format";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  CreditCard,
  PiggyBank,
  Wallet,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { format } from "date-fns";
import { PlaidConnectButton } from "@/components/accounts/plaid-connect-button";
import { PlaidConnectionCleanup } from "@/components/accounts/plaid-connection-cleanup";
import {
  SUPPORTED_ACCOUNT_TYPES,
  isSupportedAccountType,
} from "@/lib/accounts/account-types";

const typeIcons: Record<string, LucideIcon> = {
  Checking: Wallet,
  Savings: PiggyBank,
  "Credit Card": CreditCard,
};

export default function AccountsPage() {
  const queryClient = useQueryClient();
  const [history, setHistory] = useState(false);
  const connections = useQuery({
    queryKey: ["bank-connections"],
    queryFn: getBankConnections,
  });

  const {
    data: accounts = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["accounts"],
    queryFn: getAccounts,
  });

  const plaidSyncMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/plaid/sync", { method: "POST" });
      const json = (await response.json().catch(() => ({}))) as {
        accounts?: number;
        transactions?: number;
        duplicatesLinked?: number;
        failures?: Array<{
          institutionName: string;
          message: string;
        }>;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(json.error || "Failed to sync Plaid accounts");
      }
      return json;
    },
    onSuccess: (summary) => {
      void invalidateFinance(queryClient);

      if (summary.failures && summary.failures.length > 0) {
        const failedBanks = summary.failures
          .map((failure) => failure.institutionName)
          .join(", ");
        toast.warning(
          `Some banks need attention: ${failedBanks}. Retry sync or reconnect when requested.`,
        );
        return;
      }

      const linked = summary.duplicatesLinked ?? 0;
      const duplicateText =
        linked > 0 ? ` and linked ${linked} existing duplicates` : "";
      toast.success(
        `Plaid synced ${summary.accounts ?? 0} accounts and ${summary.transactions ?? 0} transactions${duplicateText}`,
      );
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const visibleAccounts = accounts.filter(
    (account) =>
      history || (!account.hidden && isSupportedAccountType(account.type)),
  );

  const grouped = [
    ...new Set<string>([
      ...SUPPORTED_ACCOUNT_TYPES,
      ...visibleAccounts.map((account) => account.type ?? "Other"),
    ]),
  ]
    .map((type) => ({
      type,
      accounts: visibleAccounts.filter(
        (account) => (account.type ?? "Other") === type,
      ),
    }))
    .filter((group) => group.accounts.length > 0);

  const hasPlaidConnections =
    connections.data?.some(
      (connection) =>
        connection.status === "active" || connection.status === "error",
    ) ?? false;

  if (isError)
    return (
      <div role="alert" className="rounded border p-6">
        {saveError(error)}{" "}
        <Button variant="outline" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold">Accounts</h2>
        <div className="flex items-center gap-2">
          <PlaidConnectButton />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (!hasPlaidConnections) {
                toast.info("Connect Plaid first to sync bank accounts.");
                return;
              }
              plaidSyncMutation.mutate();
            }}
            disabled={plaidSyncMutation.isPending}
            title={
              hasPlaidConnections
                ? "Refresh connected Plaid accounts"
                : "Connect Plaid first to sync bank accounts"
            }
          >
            <RefreshCw
              className={cn(
                "h-4 w-4 mr-1",
                plaidSyncMutation.isPending && "animate-spin",
              )}
            />
            {hasPlaidConnections ? "Sync Plaid" : "Connect Plaid first"}
          </Button>
        </div>
      </div>

      <PlaidConnectionCleanup />
      <ProviderReviews />
      <LegacyConnections />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={history}
          onChange={(event) => setHistory(event.target.checked)}
        />
        Show hidden and other historical accounts
      </label>
      <p className="text-xs text-muted-foreground">
        Hiding an account does not exclude its transactions from Budget. Bank
        disconnection retains the ledger.
      </p>

      {grouped.map(({ type, accounts: accts }) => {
        const Icon = typeIcons[type] ?? Wallet;
        return (
          <div key={type} className="space-y-3">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Icon className="h-5 w-5" />
              {type}
            </h3>
            <div className="grid gap-3 md:grid-cols-2">
              {accts.map((a) => (
                <Card key={a.id} className={cn(a.hidden && "opacity-50")}>
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {a.name}{" "}
                          {a.hidden ? (
                            <Badge variant="outline">Hidden</Badge>
                          ) : null}
                        </p>
                        <p className="mt-1 text-lg font-semibold tabular-nums">
                          {a.current_balance == null
                            ? "Balance unavailable"
                            : money(a.current_balance)}
                        </p>
                        {history && a.initial_value != null ? (
                          <p className="text-xs text-muted-foreground">
                            Recorded opening value: {money(a.initial_value)}
                            {a.initial_date
                              ? " · " + a.initial_date.slice(0, 10)
                              : ""}
                          </p>
                        ) : null}
                        <Link
                          className="text-xs text-primary underline"
                          href={
                            "/transactions?accountId=" + a.id + "&history=all"
                          }
                        >
                          View all activity and history
                        </Link>
                        <p className="text-sm text-muted-foreground">
                          {a.institution}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {a.last_synced_at
                            ? `Updated ${format(new Date(a.last_synced_at), "MMM d, yyyy 'at' h:mm a")}`
                            : "Never synced"}
                        </p>
                        {a.connection_provider === "plaid" && (
                          <Badge
                            variant="outline"
                            className="mt-2 text-xs border-emerald-200 text-emerald-700"
                          >
                            Plaid
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
