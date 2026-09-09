import { supabase } from "@/lib/supabase/client";
import { getCurrentUserId } from "@/lib/supabase/auth";

export interface Account {
  id: string;
  name: string;
  institution: string;
  type: string | null;
  current_balance: number | null;
  initial_value: number | null;
  initial_date: string | null;
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
  error_code: string | null;
  error_message: string | null;
}

export async function getAccounts(): Promise<Account[]> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("accounts")
    .select(
      "id, name, institution, type, current_balance, initial_value, initial_date, last_synced_at, plaid_account_id, connection_provider, external_account_id, hidden",
    )
    .eq("user_id", userId)
    .order("institution")
    .order("name");

  if (error) throw error;
  return data ?? [];
}

export async function getBankConnections(): Promise<BankConnectionStatus[]> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("bank_connections")
    .select(
      "id, institution_name, institution_id, last_synced_at, provider, status, error_code, error_message",
    )
    .eq("user_id", userId)
    .eq("provider", "plaid")
    .order("institution_name");

  if (error) throw error;
  return data ?? [];
}
