import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReviewManifest,
  manifestApprovalToken,
  validateReviewManifest,
} from "./statement-review.mjs";

function proposedRow(overrides = {}) {
  return {
    sourceRecordId: "source-1",
    statementAccountKey: "bank:checking:1234",
    transactionDate: "2026-01-10",
    postedDate: "2026-01-11",
    appliedDate: "2026-01-11",
    amount: -42.5,
    description: "ORDINARY PURCHASE",
    statementFile: "Bank/statement.pdf",
    statementPeriodStart: "2026-01-01",
    statementPeriodEnd: "2026-01-31",
    externalTransactionId: "stmt_external_1",
    insertRecord: {
      date: "2026-01-11",
      description: "ORDINARY PURCHASE",
      amount: -42.5,
      account_id: "account-1",
      user_id: "user-1",
    },
    ...overrides,
  };
}

function baseReport() {
  return {
    reportId: "report-1",
    accountMappings: [
      {
        statementAccountKey: "bank:checking:1234",
        status: "mapped",
        accountId: "account-1",
        confirmationRequired: false,
        observedStatementLast4s: ["1234"],
        rationale: "Unique match.",
        candidates: [
          {
            id: "account-1",
            name: "Checking",
            institution: "Bank",
            hidden: false,
          },
        ],
      },
    ],
    datePolicies: [
      {
        statementAccountKey: "bank:checking:1234",
        policy: "posted_date",
        status: "evidence_confirmed",
      },
    ],
    proposedInsertions: [proposedRow()],
    exactMatches: [],
    highConfidenceMatches: [],
    possibleMatches: [],
    conflicts: [],
    likelyDuplicates: [],
    existingNotInStatements: [],
    unmappedTransactions: [],
  };
}

test("review manifest approves unchanged low-risk rows and fingerprints them", () => {
  const report = baseReport();
  const snapshot = {
    accounts: [{ id: "account-1" }],
    transactions: [],
  };
  const manifest = buildReviewManifest(report, snapshot);
  const validation = validateReviewManifest(report, manifest);
  assert.equal(validation.approved.length, 1);
  assert.equal(validation.excluded.length, 0);
  assert.equal(manifest.approvalToken, manifestApprovalToken(manifest));
});

test("editing a decision changes the token and blocks the row", () => {
  const report = baseReport();
  const manifest = buildReviewManifest(report, {
    accounts: [{ id: "account-1" }],
    transactions: [],
  });
  const originalToken = manifest.approvalToken;
  manifest.insertionDecisions[0].decision = "pending";
  assert.notEqual(manifestApprovalToken(manifest), originalToken);
  const validation = validateReviewManifest(report, manifest);
  assert.equal(validation.approved.length, 0);
  assert.deepEqual(validation.excluded[0].reasons, ["row_pending"]);
});

test("uncertain duplicate accounts recommend the edited primary and retain the other as an alias", () => {
  const report = baseReport();
  report.accountMappings = [
    {
      statementAccountKey: "grasshopper:checking:6265",
      status: "uncertain",
      accountId: null,
      confirmationRequired: false,
      observedStatementLast4s: ["6265"],
      rationale: "Two visible matches.",
      candidates: [
        { id: "primary", name: "Business", institution: "Grasshopper", hidden: false },
        { id: "duplicate", name: "Business", institution: "Grasshopper", hidden: false },
      ],
    },
  ];
  report.proposedInsertions = [];
  report.datePolicies = [];
  report.unmappedTransactions = [
    {
      statementAccountKey: "grasshopper:checking:6265",
      transactionDate: "2026-01-02",
      amount: -10,
      description: "MERCHANT",
    },
  ];
  const manifest = buildReviewManifest(report, {
    accounts: [{ id: "primary" }, { id: "duplicate" }],
    transactions: [
      {
        id: "p1",
        account_id: "primary",
        date: "2026-01-02",
        amount: -10,
        description: "MERCHANT",
        category_id: "category-1",
        parent_id: null,
      },
      {
        id: "d1",
        account_id: "duplicate",
        date: "2026-01-02",
        amount: -10,
        description: "MERCHANT",
        category_id: null,
        parent_id: null,
      },
    ],
  });
  const decision = manifest.accountDecisions[0];
  assert.equal(decision.decision, "pending");
  assert.equal(decision.recommendedAccountId, "primary");
  assert.deepEqual(decision.aliasAccountIds, ["duplicate"]);
});
