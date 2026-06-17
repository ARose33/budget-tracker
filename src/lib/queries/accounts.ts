import { supabase } from "@/lib/supabase/client";
import { getCurrentUserId } from "@/lib/supabase/auth";

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
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("accounts")
    .select("id, name, institution, type, current_balance, last_synced_at, plaid_account_id, hidden")
    .eq("user_id", userId)
    .order("institution")
    .order("name");

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
  type: string;
  current_balance: number;
}) {
  const userId = await getCurrentUserId();

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
