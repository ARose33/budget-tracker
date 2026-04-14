import { supabase } from "@/lib/supabase/client";

export interface Account {
  id: string;
  name: string;
  institution: string;
  type: string | null;
  current_balance: number | null;
  last_synced_at: string | null;
  plaid_account_id: string | null;
  hidden: boolean;
}

export async function getAccounts(): Promise<Account[]> {
  const { data, error } = await supabase
    .from("accounts")
    .select("id, name, institution, type, current_balance, last_synced_at, plaid_account_id, hidden")
    .order("institution")
    .order("name");

  if (error) throw error;
  return data ?? [];
}

export async function toggleAccountHidden(accountId: string, hidden: boolean) {
  const { error } = await supabase
    .from("accounts")
    .update({ hidden })
    .eq("id", accountId);
  if (error) throw error;
}

export async function createAccount(input: {
  name: string;
  institution: string;
  type: string;
  current_balance: number;
}) {
  // Get an existing user_id to reuse (RLS constraint)
  const { data: existing } = await supabase
    .from("accounts")
    .select("user_id")
    .limit(1)
    .single();

  const { data, error } = await supabase
    .from("accounts")
    .insert({
      name: input.name,
      institution: input.institution,
      type: input.type,
      current_balance: input.current_balance,
      last_synced_at: new Date().toISOString(),
      user_id: existing?.user_id,
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
  const { error } = await supabase
    .from("accounts")
    .update({
      current_balance: currentBalance,
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", accountId);
  if (error) throw error;
}
