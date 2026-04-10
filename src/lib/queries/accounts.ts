import { supabase } from "@/lib/supabase/client";

export interface Account {
  id: string;
  name: string;
  institution: string;
  type: string | null;
  current_balance: number | null;
  last_synced_at: string | null;
  plaid_account_id: string | null;
}

export async function getAccounts(): Promise<Account[]> {
  const { data, error } = await supabase
    .from("accounts")
    .select("id, name, institution, type, current_balance, last_synced_at, plaid_account_id")
    .order("institution")
    .order("name");

  if (error) throw error;
  return data ?? [];
}
