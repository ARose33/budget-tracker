import { addDays, format, parseISO, subDays } from "date-fns";
import type { AccountBase, RemovedTransaction, Transaction } from "plaid";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  exchangePlaidPublicToken,
  getPlaidAccounts,
  getPlaidItem,
  syncPlaidTransactions,
} from "@/lib/plaid/client";

const PROVIDER = "plaid";
const DUPLICATE_WINDOW_DAYS = 2;

interface StoredConnection {
  id: string;
  access_token: string;
  provider_enrollment_id: string;
  institution_name: string | null;
  institution_id: string | null;
  last_synced_at: string | null;
  sync_cursor: string | null;
  user_id: string;
}

interface SyncSummary {
  connections: number;
  accounts: number;
  transactions: number;
  duplicatesLinked: number;
  removed: number;
}

interface LinkMetadata {
  institution?: {
    institution_id?: string | null;
    name?: string | null;
  } | null;
}

function toAppAccountType(account: AccountBase) {
  if (account.type === "depository" && account.subtype === "checking") {
    return "Checking";
  }
  if (account.type === "depository" && account.subtype === "savings") {
    return "Savings";
  }
  if (account.type === "credit") {
    return "Credit Card";
  }
  if (account.type === "investment" || account.type === "brokerage") {
    return "Brokerage";
  }
  return account.subtype || account.type || "Other";
}

function toAppAmount(transaction: Transaction) {
  const amount = Number(transaction.amount);
  if (!Number.isFinite(amount)) return 0;
  return -amount;
}

function accountDisplayName(account: AccountBase) {
  if (account.mask) {
    return `${account.name} (...${account.mask})`;
  }
  return account.name;
}

function normalizeDescription(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(pos|debit|card|purchase|payment|online|checkcard)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value: string) {
  return new Set(value.split(" ").filter((token) => token.length >= 3));
}

function descriptionSimilarity(left: string, right: string) {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }

  return shared / Math.max(leftTokens.size, rightTokens.size);
}

function dateRange(date: string) {
  const parsed = parseISO(date);
  return {
    from: format(subDays(parsed, DUPLICATE_WINDOW_DAYS), "yyyy-MM-dd"),
    to: format(addDays(parsed, DUPLICATE_WINDOW_DAYS), "yyyy-MM-dd"),
  };
}

async function syncAccount(
  plaidAccount: AccountBase,
  userId: string,
  institutionName: string
) {
  const supabase = createServiceRoleClient();
  const currentBalance = Number(plaidAccount.balances.current);
  const syncedAt = new Date().toISOString();

  const { data: existing, error: lookupError } = await supabase
    .from("accounts")
    .select("id")
    .eq("connection_provider", PROVIDER)
    .eq("external_account_id", plaidAccount.account_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (lookupError) throw lookupError;

  const accountRow = {
    connection_provider: PROVIDER,
    external_account_id: plaidAccount.account_id,
    institution: institutionName,
    name: accountDisplayName(plaidAccount),
    type: toAppAccountType(plaidAccount),
    current_balance: Number.isFinite(currentBalance) ? currentBalance : null,
    last_synced_at: syncedAt,
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

async function findLikelyDuplicate(
  transaction: Transaction,
  localAccountId: string | null,
  userId: string
) {
  const supabase = createServiceRoleClient();
  const amount = toAppAmount(transaction);
  const { from, to } = dateRange(transaction.date);
  const normalizedPlaidDescription = normalizeDescription(
    transaction.original_description || transaction.name || transaction.merchant_name
  );

  let query = supabase
    .from("transactions")
    .select(
      "id, account_id, description, date, source, category_id, status, is_split, not_duplicate"
    )
    .eq("user_id", userId)
    .is("parent_id", null)
    .or(`connection_provider.is.null,connection_provider.neq.${PROVIDER}`)
    .gte("date", from)
    .lte("date", to)
    .gte("amount", amount - 0.005)
    .lte("amount", amount + 0.005)
    .limit(20);

  if (localAccountId) {
    query = query.or(`account_id.eq.${localAccountId},account_id.is.null`);
  }

  const { data, error } = await query;
  if (error) throw error;

  let bestMatch: { id: string; source: string | null; score: number } | null =
    null;

  for (const candidate of data ?? []) {
    const sameAccount = localAccountId && candidate.account_id === localAccountId;
    const sameDate = candidate.date === transaction.date;
    const normalizedCandidateDescription = normalizeDescription(
      candidate.description
    );
    const similarity = descriptionSimilarity(
      normalizedPlaidDescription,
      normalizedCandidateDescription
    );

    const score =
      (sameAccount ? 3 : candidate.account_id ? 0 : 1) +
      (sameDate ? 2 : 1) +
      similarity * 3;

    if (score >= 5 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = {
        id: candidate.id,
        source: candidate.source,
        score,
      };
    }
  }

  return bestMatch;
}

async function linkDuplicateTransaction(
  transactionId: string,
  transaction: Transaction,
  source: string | null
) {
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("transactions")
    .update({
      connection_provider: PROVIDER,
      external_transaction_id: transaction.transaction_id,
      external_status: transaction.pending ? "pending" : "posted",
      source: source ?? PROVIDER,
      upload_source: "plaid_sync",
    })
    .eq("id", transactionId);

  if (error) throw error;
}

async function upsertPlaidTransaction(
  transaction: Transaction,
  localAccountId: string | null,
  userId: string
) {
  const supabase = createServiceRoleClient();
  const amount = toAppAmount(transaction);
  if (amount === 0) return "skipped" as const;

  const { data: existing, error: lookupError } = await supabase
    .from("transactions")
    .select("id")
    .eq("connection_provider", PROVIDER)
    .eq("external_transaction_id", transaction.transaction_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (lookupError) throw lookupError;

  const syncedRow = {
    account_id: localAccountId,
    amount,
    date: transaction.date,
    description:
      transaction.merchant_name ||
      transaction.name ||
      transaction.original_description ||
      null,
    connection_provider: PROVIDER,
    external_transaction_id: transaction.transaction_id,
    external_status: transaction.pending ? "pending" : "posted",
    source: PROVIDER,
    upload_source: "plaid_sync",
    user_id: userId,
  };

  if (existing) {
    const { error } = await supabase
      .from("transactions")
      .update({
        account_id: syncedRow.account_id,
        amount: syncedRow.amount,
        date: syncedRow.date,
        description: syncedRow.description,
        external_status: syncedRow.external_status,
        source: syncedRow.source,
        upload_source: syncedRow.upload_source,
      })
      .eq("id", existing.id);
    if (error) throw error;
    return "synced" as const;
  }

  const duplicate = await findLikelyDuplicate(transaction, localAccountId, userId);
  if (duplicate) {
    await linkDuplicateTransaction(duplicate.id, transaction, duplicate.source);
    return "linked" as const;
  }

  const { error } = await supabase.from("transactions").insert({
    ...syncedRow,
    not_duplicate: false,
    status: "Unconfirmed",
  });
  if (error) throw error;

  return "synced" as const;
}

async function markRemovedTransactions(
  removed: RemovedTransaction[],
  userId: string
) {
  if (removed.length === 0) return 0;

  const supabase = createServiceRoleClient();
  const transactionIds = removed.map((transaction) => transaction.transaction_id);
  const { error } = await supabase
    .from("transactions")
    .update({ external_status: "removed" })
    .eq("connection_provider", PROVIDER)
    .eq("user_id", userId)
    .in("external_transaction_id", transactionIds);

  if (error) throw error;
  return removed.length;
}

async function syncAccountsForConnection(connection: StoredConnection) {
  const accounts = await getPlaidAccounts(connection.access_token);
  const accountMap = new Map<string, string>();

  for (const account of accounts) {
    const localAccountId = await syncAccount(
      account,
      connection.user_id,
      connection.institution_name ?? "Plaid"
    );
    accountMap.set(account.account_id, localAccountId);
  }

  return accountMap;
}

export async function syncPlaidConnection(connection: StoredConnection) {
  const supabase = createServiceRoleClient();
  const accountMap = await syncAccountsForConnection(connection);
  let cursor = connection.sync_cursor;
  const originalCursor = cursor;
  let hasMore = true;
  let transactionCount = 0;
  let duplicatesLinked = 0;
  let removedCount = 0;

  try {
    while (hasMore) {
      const data = await syncPlaidTransactions(connection.access_token, cursor);
      if (data.transactions_update_status === "NOT_READY") {
        cursor = originalCursor;
        break;
      }

      for (const account of data.accounts ?? []) {
        if (!accountMap.has(account.account_id)) {
          const localAccountId = await syncAccount(
            account,
            connection.user_id,
            connection.institution_name ?? "Plaid"
          );
          accountMap.set(account.account_id, localAccountId);
        }
      }

      const changedTransactions = [...data.added, ...data.modified];
      for (const transaction of changedTransactions) {
        const result = await upsertPlaidTransaction(
          transaction,
          accountMap.get(transaction.account_id) ?? null,
          connection.user_id
        );
        if (result === "synced") transactionCount += 1;
        if (result === "linked") duplicatesLinked += 1;
      }

      removedCount += await markRemovedTransactions(data.removed, connection.user_id);
      cursor = data.next_cursor;
      hasMore = data.has_more;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase
      .from("bank_connections")
      .update({
        error_message: message,
        status: "error",
        sync_cursor: originalCursor,
      })
      .eq("id", connection.id);
    throw error;
  }

  const { error } = await supabase
    .from("bank_connections")
    .update({
      last_synced_at: new Date().toISOString(),
      sync_cursor: cursor,
      status: "active",
      error_code: null,
      error_message: null,
    })
    .eq("id", connection.id);

  if (error) throw error;

  return {
    accounts: accountMap.size,
    transactions: transactionCount,
    duplicatesLinked,
    removed: removedCount,
  };
}

export async function saveAndSyncPlaidItem(
  publicToken: string,
  metadata: LinkMetadata,
  authenticatedUserId: string
): Promise<SyncSummary> {
  const supabase = createServiceRoleClient();
  const token = await exchangePlaidPublicToken(publicToken);
  const item = await getPlaidItem(token.access_token);
  const institutionName =
    metadata.institution?.name ?? item.institution_id ?? "Plaid connection";
  const institutionId =
    metadata.institution?.institution_id ?? item.institution_id ?? null;

  const { data: existing, error: lookupError } = await supabase
    .from("bank_connections")
    .select("id")
    .eq("provider", PROVIDER)
    .eq("provider_enrollment_id", token.item_id)
    .eq("user_id", authenticatedUserId)
    .maybeSingle();

  if (lookupError) throw lookupError;

  if (existing) {
    const { error } = await supabase
      .from("bank_connections")
      .update({
        access_token: token.access_token,
        institution_name: institutionName,
        institution_id: institutionId,
        status: "active",
      })
      .eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("bank_connections").insert({
      access_token: token.access_token,
      institution_name: institutionName,
      institution_id: institutionId,
      provider: PROVIDER,
      provider_enrollment_id: token.item_id,
      status: "active",
      user_id: authenticatedUserId,
    });
    if (error) throw error;
  }

  const { data: connection, error } = await supabase
    .from("bank_connections")
    .select(
      "id, access_token, provider_enrollment_id, institution_name, institution_id, last_synced_at, sync_cursor, user_id"
    )
    .eq("provider", PROVIDER)
    .eq("provider_enrollment_id", token.item_id)
    .eq("user_id", authenticatedUserId)
    .single();

  if (error) throw error;
  if (!connection.user_id) {
    throw new Error("Stored Plaid connection is missing user_id");
  }

  const summary = await syncPlaidConnection({
    ...connection,
    user_id: connection.user_id,
  });

  return {
    connections: 1,
    ...summary,
  };
}

export async function syncStoredPlaidConnectionsForUser(
  userId: string
): Promise<SyncSummary> {
  const supabase = createServiceRoleClient();
  const { data: connections, error } = await supabase
    .from("bank_connections")
    .select(
      "id, access_token, provider_enrollment_id, institution_name, institution_id, last_synced_at, sync_cursor, user_id"
    )
    .eq("provider", PROVIDER)
    .eq("status", "active")
    .eq("user_id", userId);

  if (error) throw error;
  if (!connections || connections.length === 0) {
    return {
      connections: 0,
      accounts: 0,
      transactions: 0,
      duplicatesLinked: 0,
      removed: 0,
    };
  }

  const summary: SyncSummary = {
    connections: connections.length,
    accounts: 0,
    transactions: 0,
    duplicatesLinked: 0,
    removed: 0,
  };

  for (const connection of connections) {
    if (!connection.user_id) continue;
    const result = await syncPlaidConnection({
      ...connection,
      user_id: connection.user_id,
    });
    summary.accounts += result.accounts;
    summary.transactions += result.transactions;
    summary.duplicatesLinked += result.duplicatesLinked;
    summary.removed += result.removed;
  }

  return summary;
}

export async function syncAllStoredPlaidConnections(): Promise<SyncSummary> {
  const supabase = createServiceRoleClient();
  const { data: connections, error } = await supabase
    .from("bank_connections")
    .select(
      "id, access_token, provider_enrollment_id, institution_name, institution_id, last_synced_at, sync_cursor, user_id"
    )
    .eq("provider", PROVIDER)
    .eq("status", "active")
    .not("user_id", "is", null);

  if (error) throw error;
  if (!connections || connections.length === 0) {
    return {
      connections: 0,
      accounts: 0,
      transactions: 0,
      duplicatesLinked: 0,
      removed: 0,
    };
  }

  const summary: SyncSummary = {
    connections: connections.length,
    accounts: 0,
    transactions: 0,
    duplicatesLinked: 0,
    removed: 0,
  };

  for (const connection of connections) {
    if (!connection.user_id) continue;
    const result = await syncPlaidConnection({
      ...connection,
      user_id: connection.user_id,
    });
    summary.accounts += result.accounts;
    summary.transactions += result.transactions;
    summary.duplicatesLinked += result.duplicatesLinked;
    summary.removed += result.removed;
  }

  return summary;
}

export async function syncPlaidConnectionByItemId(itemId: string) {
  const supabase = createServiceRoleClient();
  const { data: connection, error } = await supabase
    .from("bank_connections")
    .select(
      "id, access_token, provider_enrollment_id, institution_name, institution_id, last_synced_at, sync_cursor, user_id"
    )
    .eq("provider", PROVIDER)
    .eq("provider_enrollment_id", itemId)
    .maybeSingle();

  if (error) throw error;
  if (!connection?.user_id) {
    return null;
  }

  await supabase
    .from("bank_connections")
    .update({ last_webhook_at: new Date().toISOString() })
    .eq("id", connection.id);

  return syncPlaidConnection({
    ...connection,
    user_id: connection.user_id,
  });
}
