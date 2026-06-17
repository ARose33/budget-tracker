import { format, subDays } from "date-fns";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  getTellerBalances,
  listTellerAccounts,
  listTellerTransactions,
  type TellerAccount,
  type TellerEnrollmentPayload,
  type TellerTransaction,
} from "@/lib/teller/client";

const PROVIDER = "teller";
const PROVIDER_PREFIX = `${PROVIDER}:`;

interface StoredConnection {
  access_token: string;
  item_id: string;
  institution_name: string | null;
}

interface SyncSummary {
  connections: number;
  accounts: number;
  transactions: number;
}

function toAppAccountType(account: TellerAccount) {
  if (account.type === "depository" && account.subtype === "checking") {
    return "Checking";
  }
  if (account.type === "depository" && account.subtype === "savings") {
    return "Savings";
  }
  if (account.type === "credit") {
    return "Credit Card";
  }
  if (account.type === "investment") {
    return "Brokerage";
  }
  return account.subtype || account.type || "Other";
}

function toAppAmount(transaction: TellerTransaction) {
  const amount = Number(transaction.amount);
  if (!Number.isFinite(amount)) return 0;

  // Teller and Plaid both represent debits as positive values. This app stores
  // expenses as negative values and credits/income as positive values.
  return -amount;
}

function accountDisplayName(account: TellerAccount) {
  if (account.last_four) {
    return `${account.name} (...${account.last_four})`;
  }
  return account.name;
}

async function getExistingUserId() {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("accounts")
    .select("user_id")
    .not("user_id", "is", null)
    .limit(1)
    .maybeSingle();

  return data?.user_id ?? null;
}

async function syncAccount(
  accessToken: string,
  tellerAccount: TellerAccount,
  userId: string | null
) {
  const supabase = createServiceRoleClient();
  const balances = tellerAccount.links?.balances
    ? await getTellerBalances(accessToken, tellerAccount.id)
    : null;
  const currentBalance = Number(balances?.ledger ?? balances?.available ?? 0);

  const plaidAccountId = `${PROVIDER_PREFIX}${tellerAccount.id}`;
  const { data: existing, error: lookupError } = await supabase
    .from("accounts")
    .select("id")
    .eq("plaid_account_id", plaidAccountId)
    .maybeSingle();

  if (lookupError) throw lookupError;

  const accountRow = {
    institution: tellerAccount.institution.name,
    name: accountDisplayName(tellerAccount),
    plaid_account_id: plaidAccountId,
    type: toAppAccountType(tellerAccount),
    current_balance: Number.isFinite(currentBalance) ? currentBalance : null,
    last_synced_at: new Date().toISOString(),
    user_id: userId,
  };

  if (existing) {
    const { data: account, error } = await supabase
      .from("accounts")
      .update(accountRow)
      .eq("id", existing.id)
      .select("id")
      .single();

    if (error) throw error;
    return account.id;
  }

  const { data: account, error } = await supabase
    .from("accounts")
    .insert(accountRow)
    .select("id")
    .single();

  if (error) throw error;
  return account.id;
}

async function syncTransactions(
  accessToken: string,
  tellerAccount: TellerAccount,
  localAccountId: string,
  userId: string | null
) {
  if (!tellerAccount.links?.transactions) return 0;

  const supabase = createServiceRoleClient();
  const endDate = format(new Date(), "yyyy-MM-dd");
  const startDate = format(subDays(new Date(), 45), "yyyy-MM-dd");
  const transactions = await listTellerTransactions(
    accessToken,
    tellerAccount.id,
    startDate,
    endDate
  );

  if (transactions.length === 0) return 0;

  let synced = 0;
  for (const transaction of transactions) {
    const amount = toAppAmount(transaction);
    if (amount === 0) continue;

    const plaidTransactionId = `${PROVIDER_PREFIX}${transaction.id}`;
    const row = {
      account_id: localAccountId,
      amount,
      date: transaction.date,
      description: transaction.description,
      not_duplicate: false,
      plaid_transaction_id: plaidTransactionId,
      source: PROVIDER,
      status: "Unconfirmed",
      upload_source: "teller_sync",
      user_id: userId ?? undefined,
    };

    const { data: existing, error: lookupError } = await supabase
      .from("transactions")
      .select("id")
      .eq("plaid_transaction_id", plaidTransactionId)
      .maybeSingle();

    if (lookupError) throw lookupError;

    if (existing) {
      const { error } = await supabase
        .from("transactions")
        .update(row)
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("transactions").insert(row);
      if (error) throw error;
    }

    synced += 1;
  }

  return synced;
}

export async function syncTellerConnection(
  connection: StoredConnection,
  userId: string | null
) {
  const supabase = createServiceRoleClient();
  const accounts = await listTellerAccounts(connection.access_token);
  let transactionCount = 0;

  for (const tellerAccount of accounts.filter((a) => a.status === "open")) {
    const localAccountId = await syncAccount(
      connection.access_token,
      tellerAccount,
      userId
    );
    transactionCount += await syncTransactions(
      connection.access_token,
      tellerAccount,
      localAccountId,
      userId
    );
  }

  const { error } = await supabase
    .from("plaid_items")
    .update({
      institution_name: connection.institution_name,
      cursor: new Date().toISOString(),
    })
    .eq("item_id", connection.item_id);

  if (error) throw error;

  return {
    accounts: accounts.length,
    transactions: transactionCount,
  };
}

export async function saveAndSyncTellerEnrollment(
  enrollment: TellerEnrollmentPayload,
  authenticatedUserId?: string
): Promise<SyncSummary> {
  const supabase = createServiceRoleClient();
  const userId = authenticatedUserId ?? (await getExistingUserId());
  const institutionName = enrollment.enrollment.institution?.name ?? null;
  const itemId = `${PROVIDER_PREFIX}${enrollment.enrollment.id}`;

  const { data: existing, error: lookupError } = await supabase
    .from("plaid_items")
    .select("id")
    .eq("item_id", itemId)
    .maybeSingle();

  if (lookupError) throw lookupError;

  if (existing) {
    const { error } = await supabase
      .from("plaid_items")
      .update({
        access_token: enrollment.accessToken,
        institution_name: institutionName,
        cursor: null,
        user_id: userId,
      })
      .eq("id", existing.id);

    if (error) throw error;
  } else {
    const { error } = await supabase.from("plaid_items").insert({
      access_token: enrollment.accessToken,
      institution_name: institutionName,
      item_id: itemId,
      user_id: userId,
    });

    if (error) throw error;
  }

  const { data: connection, error } = await supabase
    .from("plaid_items")
    .select("access_token, item_id, institution_name")
    .eq("item_id", itemId)
    .single();

  if (error) throw error;
  if (!connection.item_id) throw new Error("Stored Teller connection is missing item_id");

  const summary = await syncTellerConnection(
    {
      access_token: connection.access_token,
      item_id: connection.item_id,
      institution_name: connection.institution_name,
    },
    userId
  );
  return {
    connections: 1,
    ...summary,
  };
}

export async function syncStoredTellerConnections(): Promise<SyncSummary> {
  const userId = await getExistingUserId();
  if (!userId) return { connections: 0, accounts: 0, transactions: 0 };
  return syncStoredTellerConnectionsForUser(userId);
}

export async function syncStoredTellerConnectionsForUser(
  userId: string
): Promise<SyncSummary> {
  const supabase = createServiceRoleClient();
  const { data: connections, error } = await supabase
    .from("plaid_items")
    .select("access_token, item_id, institution_name")
    .like("item_id", `${PROVIDER_PREFIX}%`)
    .eq("user_id", userId);

  if (error) throw error;
  if (!connections || connections.length === 0) {
    return { connections: 0, accounts: 0, transactions: 0 };
  }

  const summary: SyncSummary = {
    connections: connections.length,
    accounts: 0,
    transactions: 0,
  };

  for (const connection of connections) {
    if (!connection.item_id) continue;
    const result = await syncTellerConnection(
      {
        access_token: connection.access_token,
        item_id: connection.item_id,
        institution_name: connection.institution_name,
      },
      userId
    );
    summary.accounts += result.accounts;
    summary.transactions += result.transactions;
  }

  return summary;
}
