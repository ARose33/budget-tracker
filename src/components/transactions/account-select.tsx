"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getAccounts } from "@/lib/queries/accounts";
import { SUPPORTED_ACCOUNT_TYPES } from "@/lib/accounts/account-types";

interface AccountSelectProps {
  value: string | null;
  onValueChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function AccountSelect({
  value,
  onValueChange,
  placeholder = "Select account",
  className,
}: AccountSelectProps) {
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: getAccounts,
  });

  const visibleAccounts = accounts.filter((a) => !a.hidden);

  const grouped = SUPPORTED_ACCOUNT_TYPES.map((type) => ({
    type,
    accounts: visibleAccounts.filter((account) => account.type === type),
  })).filter((group) => group.accounts.length > 0);

  return (
    <Select value={value ?? ""} onValueChange={(v) => v && onValueChange(v)}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {grouped.map(({ type, accounts: accts }) => (
          <div key={type}>
            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
              {type}
            </div>
            {accts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name} ({a.institution})
              </SelectItem>
            ))}
          </div>
        ))}
      </SelectContent>
    </Select>
  );
}
