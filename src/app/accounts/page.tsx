"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAccounts, toggleAccountHidden } from "@/lib/queries/accounts";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Landmark,
  CreditCard,
  PiggyBank,
  TrendingUp,
  Wallet,
  Eye,
  EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { format } from "date-fns";
import { AddAccountDialog } from "@/components/accounts/add-account-dialog";
import { Plus } from "lucide-react";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

const typeIcons: Record<string, typeof Landmark> = {
  Checking: Wallet,
  Savings: PiggyBank,
  "Credit Card": CreditCard,
  Brokerage: TrendingUp,
  Retirement: TrendingUp,
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

  const visibleAccounts = showHidden
    ? accounts
    : accounts.filter((a) => !a.hidden);

  // Group by type
  const grouped = visibleAccounts.reduce(
    (acc, a) => {
      const type = a.type || "Other";
      if (!acc[type]) acc[type] = [];
      acc[type].push(a);
      return acc;
    },
    {} as Record<string, typeof visibleAccounts>
  );

  const activeAccounts = accounts.filter((a) => !a.hidden);
  const totalAssets = activeAccounts
    .filter((a) => a.type !== "Credit Card" && a.type !== "Debt")
    .reduce((s, a) => s + (a.current_balance ?? 0), 0);

  const totalLiabilities = activeAccounts
    .filter((a) => a.type === "Credit Card" || a.type === "Debt")
    .reduce((s, a) => s + Math.abs(a.current_balance ?? 0), 0);

  const hiddenCount = accounts.filter((a) => a.hidden).length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Accounts</h2>
        <div className="flex items-center gap-2">
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

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Assets</p>
            <p className="text-2xl font-bold text-emerald-600">
              {formatCurrency(totalAssets)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Liabilities</p>
            <p className="text-2xl font-bold text-red-500">
              {formatCurrency(totalLiabilities)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Net Worth</p>
            <p className="text-2xl font-bold">
              {formatCurrency(totalAssets - totalLiabilities)}
            </p>
          </CardContent>
        </Card>
      </div>

      {Object.entries(grouped).map(([type, accts]) => {
        const Icon = typeIcons[type] ?? Landmark;
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
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <p className="text-lg font-semibold">
                          {formatCurrency(a.current_balance ?? 0)}
                        </p>
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
