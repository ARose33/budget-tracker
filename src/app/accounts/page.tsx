"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getAccounts,
  toggleAccountHidden,
} from "@/lib/queries/accounts";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  CreditCard,
  PiggyBank,
  Wallet,
  Eye,
  EyeOff,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { format } from "date-fns";
import { AddAccountDialog } from "@/components/accounts/add-account-dialog";
import { PasskeySettings } from "@/components/accounts/passkey-settings";
import { PlaidConnectButton } from "@/components/accounts/plaid-connect-button";
import { Plus } from "lucide-react";
import {
  SUPPORTED_ACCOUNT_TYPES,
  type SupportedAccountType,
} from "@/lib/accounts/account-types";

const typeIcons: Record<SupportedAccountType, LucideIcon> = {
  Checking: Wallet,
  Savings: PiggyBank,
  "Credit Card": CreditCard,
};

export default function AccountsPage() {
  const queryClient = useQueryClient();
  const [showHidden, setShowHidden] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["accounts"],
    queryFn: getAccounts,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, hidden }: { id: string; hidden: boolean }) =>
      toggleAccountHidden(id, hidden),
    onSuccess: (_, { hidden }) => {
      toast.success(hidden ? "Account hidden" : "Account restored");
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });

  const plaidSyncMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/plaid/sync", { method: "POST" });
      const json = (await response.json().catch(() => ({}))) as {
        accounts?: number;
        transactions?: number;
        duplicatesLinked?: number;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(json.error || "Failed to sync Plaid accounts");
      }
      return json;
    },
    onSuccess: (summary) => {
      const linked = summary.duplicatesLinked ?? 0;
      const duplicateText =
        linked > 0 ? ` and linked ${linked} existing duplicates` : "";
      toast.success(
        `Plaid synced ${summary.accounts ?? 0} accounts and ${summary.transactions ?? 0} transactions${duplicateText}`
      );
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["budget"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const visibleAccounts = showHidden
    ? accounts
    : accounts.filter((a) => !a.hidden);

  const grouped = SUPPORTED_ACCOUNT_TYPES.map((type) => ({
    type,
    accounts: visibleAccounts.filter((account) => account.type === type),
  })).filter((group) => group.accounts.length > 0);

  const hiddenCount = accounts.filter((a) => a.hidden).length;
  const hasPlaidConnections = accounts.some(
    (account) => account.connection_provider === "plaid"
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold">Accounts</h2>
        <div className="flex flex-wrap items-center gap-2">
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
                plaidSyncMutation.isPending && "animate-spin"
              )}
            />
            {hasPlaidConnections ? "Sync Plaid" : "Connect Plaid first"}
          </Button>
          {hiddenCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowHidden(!showHidden)}
            >
              {showHidden ? (
                <EyeOff className="h-4 w-4 mr-1" />
              ) : (
                <Eye className="h-4 w-4 mr-1" />
              )}
              {showHidden
                ? "Hide hidden accounts"
                : `Show ${hiddenCount} hidden`}
            </Button>
          )}
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add Account
          </Button>
        </div>
      </div>

      <PasskeySettings />

      {grouped.map(({ type, accounts: accts }) => {
        const Icon = typeIcons[type];
        return (
          <div key={type} className="space-y-3">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Icon className="h-5 w-5" />
              {type}
            </h3>
            <div className="grid gap-3 md:grid-cols-2">
              {accts.map((a) => (
                <Card
                  key={a.id}
                  className={cn(a.hidden && "opacity-50")}
                >
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{a.name}</p>
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
                      <div className="flex flex-col items-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-muted-foreground"
                          onClick={() =>
                            toggleMutation.mutate({
                              id: a.id,
                              hidden: !a.hidden,
                            })
                          }
                        >
                          {a.hidden ? (
                            <>
                              <Eye className="h-3 w-3 mr-1" />
                              Show
                            </>
                          ) : (
                            <>
                              <EyeOff className="h-3 w-3 mr-1" />
                              Hide
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                    {a.hidden && (
                      <Badge
                        variant="outline"
                        className="mt-2 text-xs border-yellow-200 text-yellow-700"
                      >
                        Hidden
                      </Badge>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        );
      })}

      <AddAccountDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
