export interface ProviderAccount { provider_id: string; name: string; institution: string; type: string; balance: number | null }
export interface ProviderTransaction { provider_id: string; pending_id: string | null; account_provider_id: string; date: string; description: string | null; amount: number; pending: boolean }
export interface SyncLease { token: string; generation: number; cursor: string | null }
export interface CycleResult { accounts: number; transactions: number; duplicatesLinked: number; removed: number; reviews?: number; notReady?: boolean }
export interface SyncPage { accounts: ProviderAccount[]; changed: ProviderTransaction[]; removed: string[]; next_cursor: string; has_more: boolean; not_ready: boolean }
export interface SyncDependencies {
  acquire: () => Promise<SyncLease>;
  accounts: () => Promise<ProviderAccount[]>;
  page: (cursor: string | null) => Promise<SyncPage>;
  apply: (lease: SyncLease, accounts: ProviderAccount[], changed: ProviderTransaction[], removed: string[], cursor: string) => Promise<CycleResult>;
  receipt: (lease: SyncLease) => Promise<CycleResult | null>;
  release: (lease: SyncLease, errorCode?: string) => Promise<void>;
  now?: () => number;
}
function errorCode(error: unknown) {
  if (error && typeof error === "object") {
    if ("errorCode" in error && typeof error.errorCode === "string") return error.errorCode;
    if ("code" in error && typeof error.code === "string") return error.code;
  }
  return "SYNC_INCOMPLETE";
}
export async function runSyncCycle(deps: SyncDependencies): Promise<CycleResult> {
  const now = deps.now ?? Date.now;
  const start = now();
  const lease = await deps.acquire();
  let failure: string | undefined;
  try {
    const initialAccounts = await deps.accounts();
    let retries = 0;
    while (true) {
      const accounts = new Map(initialAccounts.map(account => [account.provider_id, account]));
      const changed: ProviderTransaction[] = [], removed: string[] = [];
      let cursor = lease.cursor;
      try {
        for (let pages = 0; ; pages++) {
          if (now() - start > 45_000) throw new Error("Sync timed out before committing. Retry this connection.");
          if (pages >= 100) throw new Error("This provider cycle exceeds the supported size. No cycle data was committed.");
          const page = await deps.page(cursor);
          if (page.not_ready) return { accounts: 0, transactions: 0, duplicatesLinked: 0, removed: 0, reviews: 0, notReady: true };
          for (const account of page.accounts) accounts.set(account.provider_id, account);
          changed.push(...page.changed); removed.push(...page.removed);
          if (changed.length > 50_000 || removed.length > 50_000) throw new Error("Provider cycle is too large. No cycle data was committed.");
          cursor = page.next_cursor;
          if (!page.has_more) {
            if (now() - start > 45_000) throw new Error("Sync timed out before committing. Retry this connection.");
            return await deps.apply(lease, [...accounts.values()], changed, removed, cursor);
          }
        }
      } catch (error) {
        if (errorCode(error) === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" && retries++ < 2) continue;
        throw error;
      }
    }
  } catch (error) {
    // A lost response can follow a successful atomic commit. Recover its durable receipt.
    const completed = await deps.receipt(lease).catch(() => null);
    if (completed) return completed;
    failure = errorCode(error);
    throw error;
  } finally {
    // A crashed process can leave only an expiring lease, never a permanent lock.
    await deps.release(lease, failure).catch(() => { /* The lease expires; preserve the proven ledger result or original failure. */ });
  }
}
