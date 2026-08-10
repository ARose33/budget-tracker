import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReconciliationWindows,
  isWithinReconciliationWindow,
} from "./statement-reconciler.mjs";

const mappings = [
  {
    statementAccountKey: "bank:checking:1234",
    status: "mapped",
    accountId: "account-1",
    aliasAccountIds: ["account-old"],
  },
];

test("reconciliation windows ignore prior statement imports and include aliases", () => {
  const windows = buildReconciliationWindows(mappings, [
    {
      account_id: "account-1",
      date: "2023-01-01",
      connection_provider: "statement",
    },
    {
      account_id: "account-old",
      date: "2024-01-15",
      connection_provider: "plaid",
    },
    {
      account_id: "account-1",
      date: "2026-03-20",
      connection_provider: "plaid",
    },
  ]);
  assert.deepEqual(windows[0], {
    statementAccountKey: "bank:checking:1234",
    accountIds: ["account-1", "account-old"],
    firstExistingDate: "2024-01-15",
    lastExistingDate: "2026-03-20",
    existingTransactionCount: 2,
  });
});

test("only transaction or posted dates inside the existing-history window reconcile", () => {
  const window = {
    firstExistingDate: "2024-01-15",
    lastExistingDate: "2026-03-20",
  };
  assert.equal(
    isWithinReconciliationWindow(
      { transactionDate: "2023-01-10", postedDate: "2023-01-12" },
      window
    ),
    false
  );
  assert.equal(
    isWithinReconciliationWindow(
      { transactionDate: "2024-01-14", postedDate: "2024-01-15" },
      window
    ),
    true
  );
  assert.equal(
    isWithinReconciliationWindow(
      { transactionDate: "2026-03-21", postedDate: null },
      window
    ),
    false
  );
});
