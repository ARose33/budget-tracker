import { supabase } from "@/lib/supabase/client";
import { getCurrentUserId } from "@/lib/supabase/auth";
import {
  SUPPORTED_ACCOUNT_TYPES,
  isSupportedAccountType,
  type SupportedAccountType,
} from "@/lib/accounts/account-types";

export interface Account {
  id: string;
  name: string;
  institution: string;
  type: SupportedAccountType | null;
  current_balance: number | null;
  last_synced_at: string | null;
  plaid_account_id: string | null;
  connection_provider: string;
  external_account_id: string | null;
  hidden: boolean;
}

export interface BankConnectionStatus {
  id: string;
  institution_name: string | null;
  institution_id: string | null;
  last_synced_at: string | null;
  provider: string;
  status: string;
}

export async function getAccounts(): Promise<Account[]> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("accounts")
    .select(
      "id, name, institution, type, current_balance, last_synced_at, plaid_account_id, connection_provider, external_account_id, hidden"
    )
    .eq("user_id", userId)
    .in("type", [...SUPPORTED_ACCOUNT_TYPES])
    .order("institution")
    .order("name");

  if (error) throw error;
  return (data ?? []).filter((account): account is Account =>
    isSupportedAccountType(account.type)
  );
}

export async function getBankConnections(): Promise<BankConnectionStatus[]> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("bank_connections")
    .select("id, institution_name, institution_id, last_synced_at, provider, status")
    .eq("user_id", userId)
    .eq("provider", "plaid")
    .eq("status", "active")
    .order("institution_name");

  if (error) throw error;
  return data ?? [];
}

export async function toggleAccountHidden(accountId: string, hidden: boolean) {
  const userId = await getCurrentUserId();
  const { error } = await supabase
    .from("accounts")
    .update({ hidden })
    .eq("id", accountId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function createAccount(input: {
  name: string;
  institution: string;
  type: SupportedAccountType;
  current_balance: number;
}) {
  const userId = await getCurrentUserId();
  if (!isSupportedAccountType(input.type)) {
    throw new Error("Unsupported account type");
  }

  const { data, error } = await supabase
    .from("accounts")
    .insert({
      name: input.name,
      institution: input.institution,
      type: input.type,
      current_balance: input.current_balance,
      last_synced_at: new Date().toISOString(),
      user_id: userId,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateAccountBalance(
  accountId: string,
  currentBalance: number
) {
  const userId = await getCurrentUserId();
  const { error } = await supabase
    .from("accounts")
    .update({
      current_balance: currentBalance,
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", accountId)
    .eq("user_id", userId);
  if (error) throw error;
}
