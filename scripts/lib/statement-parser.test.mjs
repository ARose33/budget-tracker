import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { parseStatementFile } from "./statement-parser.mjs";

const statementsRoot = path.resolve("Statements", "Budget Input");

async function parseFixture(relativePath, testContext) {
  const filePath = path.join(statementsRoot, relativePath);
  try {
    await fs.access(filePath);
  } catch {
    testContext.skip(`Statement fixture is not available: ${relativePath}`);
    return null;
  }
  return parseStatementFile(filePath, statementsRoot);
}

function assertAllBalancesPass(parsed) {
  assert.ok(parsed.validations.length > 0);
  assert.deepEqual(
    parsed.validations.map((validation) => validation.status),
    parsed.validations.map(() => "pass")
  );
  assert.ok(!parsed.warnings.includes("statement_balance_validation_failed"));
}

test("Capital One combined statements handle wrapped transfer amounts", async (t) => {
  const parsed = await parseFixture(
    path.join("Cap1 savings & checking", "20260501-Bank statement.pdf"),
    t
  );
  if (!parsed) return;
  assertAllBalancesPass(parsed);
  assert.ok(
    parsed.transactions.some(
      (transaction) =>
        transaction.statementAccountKey === "capital_one:savings:0580" &&
        transaction.amount === -140000
    )
  );
});

test("Chase credit statements retain fractional-dollar rows and signed refunds", async (t) => {
  const parsed = await parseFixture(
    path.join("Chase Freedom", "20230907-statements-6158-.pdf"),
    t
  );
  if (!parsed) return;
  assertAllBalancesPass(parsed);
  assert.ok(parsed.transactions.some((transaction) => transaction.amount === -0.78));
});

test("Chase credit multiline descriptions exclude repeated page furniture", async (t) => {
  const parsed = await parseFixture(
    path.join("Chase Reserve", "20260428-statements-5420-.pdf"),
    t
  );
  if (!parsed) return;
  assertAllBalancesPass(parsed);
  const transaction = parsed.transactions.find(
    (row) => row.transactionDate === "2026-04-22" && row.amount === -47.97
  );
  assert.equal(transaction?.description, "LYFT *RIDE TUE 3PM LYFT.COM CA");
  assert.ok(
    parsed.transactions.every(
      (row) => !/Page \d+ of \d+|Statement Date:|FIS\d+|ACCOUNT ACTIVITY \(CONTINUED\)/i.test(row.description)
    )
  );
});

test("Grasshopper multiline descriptions exclude page and transaction-detail furniture", async (t) => {
  const fixtures = [
    path.join("Grasshopper", "pats2434-06_01_24.pdf"),
    path.join("Grasshopper", "pats2434-03_31_26.pdf"),
  ];
  for (const fixture of fixtures) {
    const parsed = await parseFixture(fixture, t);
    if (!parsed) return;
    assertAllBalancesPass(parsed);
    assert.ok(
      parsed.transactions.every(
        (row) =>
          !/Page\s*:\s*\d+\s+of\s+\d+|M\d{6}S\d+|ROSE RESIDENCES|Transaction Detail \(Continued\)|Date Description Deposits Withdrawals Balance/i.test(
            row.description
          )
      )
    );
  }
});

test("Capital One credit statements include fees and interest", async (t) => {
  const parsed = await parseFixture(
    path.join("QuickSilver_VentureX", "Statement_032024_9401.pdf"),
    t
  );
  if (!parsed) return;
  assertAllBalancesPass(parsed);
  assert.ok(parsed.transactions.some((transaction) => transaction.amount === -25));
  assert.ok(parsed.transactions.some((transaction) => transaction.amount === -36.61));
});

test("zero-activity statements validate without a parse failure", async (t) => {
  const parsed = await parseFixture(
    path.join("Chase Freedom", "20241007-statements-6158-.pdf"),
    t
  );
  if (!parsed) return;
  assertAllBalancesPass(parsed);
  assert.equal(parsed.transactions.length, 0);
  assert.deepEqual(parsed.warnings, []);
});
