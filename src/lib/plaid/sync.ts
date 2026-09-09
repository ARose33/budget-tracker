import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AccountBase, Transaction } from "plaid";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { exchangePlaidPublicToken, getPlaidAccounts, getPlaidItem, normalizePlaidError, removePlaidItem, syncPlaidTransactions } from "@/lib/plaid/client";
import { runSyncCycle, type ProviderAccount, type ProviderTransaction } from "@/lib/plaid/sync-cycle";
const PROVIDER = "plaid";
interface StoredConnection {
  id: string; access_token: string; provider_enrollment_id: string;
  institution_name: string | null; institution_id: string | null; last_synced_at: string | null; sync_cursor: string | null; user_id: string;
}
interface ConnectionFailure { connectionId: string; institutionName: string; errorCode: string | null; message: string }
export interface SyncSummary { connections: number; accounts: number; transactions: number; duplicatesLinked: number; removed: number; failures: ConnectionFailure[]; reviews?: number }
interface LinkMetadata { institution?: { institution_id?: string | null; name?: string | null } | null }
export class DuplicatePlaidInstitutionError extends Error {
  constructor(institutionName: string) {
    super(institutionName + " is already connected. Use the existing connection instead of connecting it again.");
    this.name = "DuplicatePlaidInstitutionError";
  }
}
function providerAccount(account: AccountBase, institution: string): ProviderAccount {
  if (account.balances.current !== null && !Number.isFinite(account.balances.current)) throw new Error("Provider returned an invalid account balance.");
  const type = account.type === "depository" && account.subtype === "checking" ? "Checking" :
    account.type === "depository" && account.subtype === "savings" ? "Savings" : account.type === "credit" ? "Credit Card" :
    account.type === "investment" || account.type === "brokerage" ? "Brokerage" : account.subtype || account.type || "Other";
  return { provider_id: account.account_id, name: account.mask ? account.name + " (..." + account.mask + ")" : account.name,
    institution, type, balance: account.balances.current === null ? null : Number(account.balances.current) };
}
function providerTransaction(transaction: Transaction): ProviderTransaction {
  if (!Number.isFinite(transaction.amount)) throw new Error("Provider returned an invalid amount.");
  return { provider_id: transaction.transaction_id, pending_id: transaction.pending_transaction_id ?? null,
    account_provider_id: transaction.account_id, date: transaction.date,
    description: transaction.merchant_name || transaction.name || transaction.original_description || null,
    amount: -transaction.amount, pending: transaction.pending };
}
const resultSchema = z.object({ accounts: z.number(), transactions: z.number(), duplicatesLinked: z.number(), removed: z.number(), reviews: z.number().optional(), notReady: z.boolean().optional() });
export async function syncPlaidConnection(connection: StoredConnection) {
  if (process.env.STACKMINT_ISOLATED === "true") throw new Error("External sync is disabled in isolated verification.");
  const supabase = createServiceRoleClient();
  const operationId = randomUUID();
  return runSyncCycle({
    acquire: async () => {
      const { data, error } = await supabase.rpc("stackmint_acquire_sync", { p_connection_id: connection.id, p_token: operationId });
      if (error) throw error;
      return z.object({ token: z.string(), generation: z.number(), cursor: z.string().nullable() }).parse(data);
    },
    accounts: async () => (await getPlaidAccounts(connection.access_token)).map(account => providerAccount(account, connection.institution_name ?? "Plaid")),
    page: async cursor => {
      const page = await syncPlaidTransactions(connection.access_token, cursor);
      return { accounts: (page.accounts ?? []).map(account => providerAccount(account, connection.institution_name ?? "Plaid")),
        changed: [...page.added, ...page.modified].map(providerTransaction), removed: page.removed.map(transaction => transaction.transaction_id),
        next_cursor: page.next_cursor, has_more: page.has_more, not_ready: page.transactions_update_status === "NOT_READY" };
    },
    apply: async (lease, accounts, changed, removed, cursor) => {
      const { data, error } = await supabase.rpc("stackmint_apply_sync", { p_connection_id: connection.id, p_token: lease.token, p_generation: lease.generation,
        p_base_cursor: lease.cursor, p_next_cursor: cursor, p_accounts: accounts.map(account => ({ ...account })), p_transactions: changed.map(transaction => ({ ...transaction })), p_removed: removed });
      if (error) throw error;
      return resultSchema.parse(data);
    },
    receipt: async lease => {
      const { data, error } = await supabase.from("sync_receipts").select("result").eq("operation_id", lease.token).eq("connection_id", connection.id).maybeSingle();
      if (error) throw error;
      return data ? resultSchema.parse(data.result) : null;
    },
    release: async (lease, errorCode) => {
      const { error } = await supabase.rpc("stackmint_release_sync", { p_connection_id: connection.id, p_token: lease.token, p_error: errorCode });
      if (error) throw new Error("Sync outcome is retained, but the lease could not be released. Wait briefly before retrying.");
    },
  });
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

  if (institutionId) {
    const { data: duplicateInstitution, error: duplicateLookupError } =
      await supabase
        .from("bank_connections")
        .select("id")
        .eq("provider", PROVIDER)
        .eq("institution_id", institutionId)
        .in("status", ["active", "error"])
        .eq("user_id", authenticatedUserId)
        .neq("provider_enrollment_id", token.item_id)
        .limit(1)
        .maybeSingle();

    if (duplicateLookupError) throw duplicateLookupError;

    if (duplicateInstitution) {
      await removePlaidItem(token.access_token);
      throw new DuplicatePlaidInstitutionError(institutionName);
    }
  }

  const { data: existing, error: lookupError } = await supabase
    .from("bank_connections")
    .select("id")
    .eq("provider", PROVIDER)
    .eq("provider_enrollment_id", token.item_id)
    .eq("user_id", authenticatedUserId)
    .maybeSingle();

  if (lookupError) throw lookupError;

  if (existing) {
    // Never replace an existing connection credential during a duplicate Link exchange.
    throw new DuplicatePlaidInstitutionError(institutionName);
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
    if (error?.code === "23505" && institutionId) {
      await removePlaidItem(token.access_token);
      throw new DuplicatePlaidInstitutionError(institutionName);
    }
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
    failures: [],
  };
}

function connectionFailure(
  connection: StoredConnection,
  error: unknown
): ConnectionFailure {
  const plaidError = normalizePlaidError(error);
  return {
    connectionId: connection.id,
    institutionName: connection.institution_name ?? "Plaid connection",
    errorCode: plaidError?.errorCode ?? null,
    message:
      plaidError?.message ??
      (error instanceof Error ? error.message : String(error)),
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
    .in("status", ["active", "error"])
    .eq("user_id", userId);

  if (error) throw error;
  if (!connections || connections.length === 0) {
    return {
      connections: 0,
      accounts: 0,
      transactions: 0,
      duplicatesLinked: 0,
      removed: 0,
      failures: [],
    };
  }

  const summary: SyncSummary = {
    connections: connections.length,
    accounts: 0,
    transactions: 0,
    duplicatesLinked: 0,
    removed: 0,
    failures: [],
  };

  for (const connection of connections) {
    if (!connection.user_id) continue;
    const storedConnection = {
      ...connection,
      user_id: connection.user_id,
    };
    try {
      const result = await syncPlaidConnection(storedConnection);
      summary.accounts += result.accounts;
      summary.transactions += result.transactions;
      summary.duplicatesLinked += result.duplicatesLinked;
      summary.removed += result.removed;
      summary.reviews = (summary.reviews ?? 0) + (result.reviews ?? 0);
    } catch (error) {
      summary.failures.push(connectionFailure(storedConnection, error));
    }
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
    .in("status", ["active", "error"])
    .not("user_id", "is", null);

  if (error) throw error;
  if (!connections || connections.length === 0) {
    return {
      connections: 0,
      accounts: 0,
      transactions: 0,
      duplicatesLinked: 0,
      removed: 0,
      failures: [],
    };
  }

  const summary: SyncSummary = {
    connections: connections.length,
    accounts: 0,
    transactions: 0,
    duplicatesLinked: 0,
    removed: 0,
    failures: [],
  };

  for (const connection of connections) {
    if (!connection.user_id) continue;
    const storedConnection = {
      ...connection,
      user_id: connection.user_id,
    };
    try {
      const result = await syncPlaidConnection(storedConnection);
      summary.accounts += result.accounts;
      summary.transactions += result.transactions;
      summary.duplicatesLinked += result.duplicatesLinked;
      summary.removed += result.removed;
      summary.reviews = (summary.reviews ?? 0) + (result.reviews ?? 0);
    } catch (error) {
      summary.failures.push(connectionFailure(storedConnection, error));
    }
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
    .in("status", ["active", "error"])
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

export async function syncPlaidConnectionByIdForUser(
  connectionId: string,
  userId: string
) {
  const supabase = createServiceRoleClient();
  const { data: connection, error } = await supabase
    .from("bank_connections")
    .select(
      "id, access_token, provider_enrollment_id, institution_name, institution_id, last_synced_at, sync_cursor, user_id"
    )
    .eq("id", connectionId)
    .eq("provider", PROVIDER)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!connection?.user_id) {
    throw new Error("Plaid connection not found");
  }

  return syncPlaidConnection({
    ...connection,
    user_id: connection.user_id,
  });
}
