"use client";

import { useQuery } from "@tanstack/react-query";
import { getAccounts } from "@/lib/queries/accounts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Landmark, CreditCard, PiggyBank, TrendingUp, Wallet } from "lucide-react";

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
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["accounts"],
    queryFn: getAccounts,
  });

  // Group by type
  const grouped = accounts.reduce(
    (acc, a) => {
      const type = a.type || "Other";
      if (!acc[type]) acc[type] = [];
      acc[type].push(a);
      return acc;
    },
    {} as Record<string, typeof accounts>
  );

  const totalAssets = accounts
    .filter((a) => a.type !== "Credit Card" && a.type !== "Debt")
    .reduce((s, a) => s + (a.current_balance ?? 0), 0);

  const totalLiabilities = accounts
    .filter((a) => a.type === "Credit Card" || a.type === "Debt")
    .reduce((s, a) => s + Math.abs(a.current_balance ?? 0), 0);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold">Accounts</h2>

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
                <Card key={a.id}>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{a.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {a.institution}
                        </p>
                      </div>
                      <p className="text-lg font-semibold">
                        {formatCurrency(a.current_balance ?? 0)}
                      </p>
                    </div>
                    {a.plaid_account_id && (
                      <Badge variant="outline" className="mt-2 text-xs">
                        Plaid Connected
                      </Badge>
                    )}
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
