import test from "node:test";
import assert from "node:assert/strict";
import { runSyncCycle, type SyncDependencies, type SyncPage } from "./sync-cycle.ts";
const page = (next_cursor: string, has_more = false): SyncPage => ({ accounts: [], changed: [], removed: [], next_cursor, has_more, not_ready: false });
const result = { accounts: 1, transactions: 2, duplicatesLinked: 0, removed: 0 };
function dependencies() {
  const applied: string[] = [], released: (string | undefined)[] = [];
  const deps: SyncDependencies = {
    acquire: async () => ({ token: "synthetic-operation", generation: 1, cursor: "original" }),
    accounts: async () => [],
    page: async () => page("finished"),
    apply: async (_lease, _accounts, _changed, _removed, cursor) => { applied.push(cursor); return result; },
    receipt: async () => null,
    release: async (_lease, error) => { released.push(error); },
  };
  return { deps, applied, released };
}
test("a failed pagination loop has no ledger or cursor writes", async () => {
  const { deps, applied, released } = dependencies();
  deps.page = async cursor => { if (cursor === "original") return page("second", true); throw new Error("Synthetic outage"); };
  await assert.rejects(runSyncCycle(deps), /Synthetic outage/);
  assert.deepEqual(applied, []); assert.deepEqual(released, ["SYNC_INCOMPLETE"]);
});
test("pagination mutations restart the full loop at the original cursor before one atomic commit", async () => {
  const { deps, applied } = dependencies();
  const calls: (string | null)[] = [];
  deps.page = async cursor => {
    calls.push(cursor);
    if (cursor === "original") return page("second", true);
    if (calls.length === 2) throw { errorCode: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" };
    return page("finished");
  };
  assert.deepEqual(await runSyncCycle(deps), result);
  assert.deepEqual(calls, ["original", "second", "original", "second"]);
  assert.deepEqual(applied, ["finished"]);
});
test("a lost commit response returns the durable success receipt without reporting rollback", async () => {
  const { deps, released } = dependencies();
  deps.apply = async () => { throw new Error("Response lost"); };
  deps.receipt = async () => result;
  assert.deepEqual(await runSyncCycle(deps), result);
  assert.deepEqual(released, [undefined]);
});
test("provider NOT_READY and oversize cycles never commit partial activity", async () => {
  const first = dependencies();
  first.deps.page = async () => ({ ...page("unused"), not_ready: true });
  assert.equal((await runSyncCycle(first.deps)).notReady, true);
  assert.equal(first.applied.length, 0);
  const second = dependencies();
  second.deps.page = async () => page("still-more", true);
  await assert.rejects(runSyncCycle(second.deps), /supported size/);
  assert.equal(second.applied.length, 0);
});

test("lease-release outages preserve committed results and late final pages do not commit", async () => {
  const first = dependencies();
  first.deps.release = async () => { throw new Error("Synthetic release outage"); };
  assert.deepEqual(await runSyncCycle(first.deps), result);
  const second = dependencies();
  let time = 0;
  second.deps.now = () => time;
  second.deps.page = async () => { time = 46000; return page("too-late"); };
  await assert.rejects(runSyncCycle(second.deps), /timed out/);
  assert.deepEqual(second.applied, []);
});
