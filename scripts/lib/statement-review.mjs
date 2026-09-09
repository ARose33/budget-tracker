import { stableHash } from "./statement-parser.mjs";
import { descriptionSimilarity } from "./statement-reconciler.mjs";

const MAX_BATCH_SIZE = 250;

function dateDistance(left, right) {
  return (
    Math.abs(
      Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`),
    ) / 86_400_000
  );
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function summarizeCandidate(statementRows, existingRows) {
  const used = new Set();
  const result = { exact: 0, highConfidence: 0, possible: 0 };
  for (const statement of statementRows) {
    const candidates = existingRows
      .filter(
        (existing) =>
          !used.has(existing.id) &&
          Math.abs(Number(existing.amount) - Number(statement.amount)) <=
            0.005 &&
          dateDistance(existing.date, statement.transactionDate) <= 5,
      )
      .map((existing) => ({
        existing,
        dateDistanceDays: dateDistance(
          existing.date,
          statement.transactionDate,
        ),
        descriptionSimilarity: descriptionSimilarity(
          existing.description,
          statement.description,
        ),
      }))
      .sort(
        (left, right) =>
          left.dateDistanceDays - right.dateDistanceDays ||
          right.descriptionSimilarity - left.descriptionSimilarity ||
          left.existing.id.localeCompare(right.existing.id),
      );
    const candidate = candidates[0];
    if (!candidate) continue;
    if (
      candidate.dateDistanceDays === 0 &&
      candidate.descriptionSimilarity >= 0.99
    ) {
      result.exact += 1;
    } else if (
      candidate.dateDistanceDays <= 3 &&
      candidate.descriptionSimilarity >= 0.72
    ) {
      result.highConfidence += 1;
    } else if (candidate.descriptionSimilarity >= 0.34) {
      result.possible += 1;
    } else {
      continue;
    }
    used.add(candidate.existing.id);
  }
  result.strongMatches = result.exact + result.highConfidence;
  result.totalMatches = result.strongMatches + result.possible;
  return result;
}

function accountDecision(mapping, report, snapshot) {
  const statementRows = report.unmappedTransactions.filter(
    (row) => row.statementAccountKey === mapping.statementAccountKey,
  );
  const candidates = mapping.candidates.map((candidate) => {
    const existingRows = snapshot.transactions.filter(
      (transaction) =>
        transaction.account_id === candidate.id && !transaction.parent_id,
    );
    const dates = existingRows.map((transaction) => transaction.date).sort();
    return {
      accountId: candidate.id,
      name: candidate.name,
      institution: candidate.institution,
      hidden: candidate.hidden,
      transactionCount: existingRows.length,
      categorizedCount: existingRows.filter(
        (transaction) => transaction.category_id,
      ).length,
      firstDate: dates[0] ?? null,
      lastDate: dates.at(-1) ?? null,
      statementEvidence: summarizeCandidate(statementRows, existingRows),
    };
  });
  const recommended = [...candidates].sort(
    (left, right) =>
      right.categorizedCount - left.categorizedCount ||
      right.statementEvidence.strongMatches -
        left.statementEvidence.strongMatches ||
      right.transactionCount - left.transactionCount ||
      left.accountId.localeCompare(right.accountId),
  )[0];
  const existingMatchEvidence = {
    exact: report.exactMatches.filter(
      (row) => row.statementAccountKey === mapping.statementAccountKey,
    ).length,
    highConfidence: report.highConfidenceMatches.filter(
      (row) => row.statementAccountKey === mapping.statementAccountKey,
    ).length,
  };
  existingMatchEvidence.strongMatches =
    existingMatchEvidence.exact + existingMatchEvidence.highConfidence;
  const historicalCardRotationConfirmed =
    mapping.confirmationRequired && existingMatchEvidence.strongMatches >= 20;
  const needsReview =
    mapping.status !== "mapped" ||
    (mapping.confirmationRequired && !historicalCardRotationConfirmed);
  return {
    statementAccountKey: mapping.statementAccountKey,
    decision: needsReview ? "pending" : "approved",
    approvedAccountId: mapping.accountId ?? recommended?.accountId ?? null,
    recommendedAccountId: mapping.accountId ?? recommended?.accountId ?? null,
    aliasAccountIds:
      mapping.status !== "mapped"
        ? candidates
            .map((candidate) => candidate.accountId)
            .filter((accountId) => accountId !== recommended?.accountId)
        : [],
    observedStatementLast4s: mapping.observedStatementLast4s ?? [],
    existingMatchEvidence,
    historicalCardRotationConfirmed,
    rationale: mapping.rationale,
    candidates,
  };
}

function riskFlags(row, accountDecisionRow, dateDecision) {
  const flags = [];
  const description = row.description.toLowerCase();
  if (Math.abs(Number(row.amount)) >= 5000) flags.push("high_value");
  if (
    /transfer|trnsfr|xfer|ach|payment|pymt|withdrawal to|deposit from/.test(
      description,
    )
  ) {
    flags.push("transfer_or_payment");
  }
  if (/refund|reversal|adjustment|credit|fee|interest/.test(description)) {
    flags.push("credit_refund_fee_or_interest");
  }
  if (
    row.statementAccountKey.includes(":credit_card:") &&
    Number(row.amount) > 0
  ) {
    flags.push("positive_credit_card_amount");
  }
  if (
    row.appliedDate < row.statementPeriodStart ||
    row.appliedDate > row.statementPeriodEnd
  ) {
    flags.push("cross_statement_period_date");
  }
  if (accountDecisionRow?.decision !== "approved")
    flags.push("account_mapping_pending");
  if (dateDecision?.decision !== "approved") flags.push("date_policy_pending");
  return [...new Set(flags)];
}

function rowFingerprint(row) {
  return stableHash(
    JSON.stringify({
      sourceRecordId: row.sourceRecordId,
      accountId: row.insertRecord.account_id,
      date: row.insertRecord.date,
      amount: Number(row.insertRecord.amount).toFixed(2),
      description: row.insertRecord.description,
      externalTransactionId: row.externalTransactionId,
      statementFile: row.statementFile,
    }),
  );
}

function manifestWithoutToken(manifest) {
  const result = { ...manifest };
  delete result.approvalToken;
  return result;
}

export function manifestApprovalToken(manifest) {
  return stableHash(JSON.stringify(manifestWithoutToken(manifest))).slice(
    0,
    24,
  );
}

export function buildReviewManifest(report, snapshot) {
  const accountDecisions = report.accountMappings.map((mapping) =>
    accountDecision(mapping, report, snapshot),
  );
  const accountByKey = new Map(
    accountDecisions.map((decision) => [
      decision.statementAccountKey,
      decision,
    ]),
  );
  const dateDecisions = report.datePolicies.map((policy) => ({
    ...policy,
    decision: "approved",
  }));
  const dateByKey = new Map(
    dateDecisions.map((decision) => [decision.statementAccountKey, decision]),
  );
  const insertionDecisions = report.proposedInsertions.map((row) => {
    const flags =
      row.reconciliationRequired === false
        ? []
        : riskFlags(
            row,
            accountByKey.get(row.statementAccountKey),
            dateByKey.get(row.statementAccountKey),
          );
    return {
      sourceRecordId: row.sourceRecordId,
      rowFingerprint: rowFingerprint(row),
      statementAccountKey: row.statementAccountKey,
      appliedDate: row.appliedDate,
      amount: row.amount,
      description: row.description,
      statementFile: row.statementFile,
      riskFlags: flags,
      recommendation: flags.length === 0 ? "approve" : "review",
      decision: flags.length === 0 ? "approved" : "pending",
      reviewNote: "",
    };
  });
  const manifest = {
    schemaVersion: 1,
    reportId: report.reportId,
    generatedAt: new Date().toISOString(),
    accountDecisions,
    dateDecisions,
    insertionDecisions,
    reviewQueues: {
      possibleMatches: report.possibleMatches.map((row) => ({
        sourceRecordId: row.sourceRecordId,
        decision: "pending",
        candidateSupabaseTransactionIds: row.candidateSupabaseTransactionIds,
        reviewNote: "",
      })),
      conflicts: report.conflicts.map((row) => ({
        sourceRecordId: row.sourceRecordId,
        decision: "pending",
        candidateSupabaseTransactionIds: row.candidateSupabaseTransactionIds,
        reviewNote: "",
      })),
      likelyDuplicates: report.likelyDuplicates.map((row, index) => ({
        reviewKey:
          row.sourceRecordId ?? row.identityKey ?? `duplicate-${index + 1}`,
        decision: "leave_unchanged",
        reviewNote:
          "No existing rows will be deleted by the statement workflow.",
      })),
      existingNotInStatements: report.existingNotInStatements.map((row) => ({
        supabaseTransactionId: row.supabaseTransactionId,
        decision: "leave_unchanged",
        reviewNote:
          "No existing rows will be deleted by the statement workflow.",
      })),
    },
  };
  manifest.approvalToken = manifestApprovalToken(manifest);
  return manifest;
}

function matchesFilters(row, filters) {
  if (filters.account && row.statementAccountKey !== filters.account)
    return false;
  if (filters.year && row.appliedDate.slice(0, 4) !== filters.year)
    return false;
  if (filters.month && row.appliedDate.slice(0, 7) !== filters.month)
    return false;
  return true;
}

export function validateReviewManifest(report, manifest, filters = {}) {
  if (manifest.schemaVersion !== 1)
    throw new Error("Unsupported review manifest schema.");
  if (manifest.reportId !== report.reportId) {
    throw new Error(
      "Review manifest belongs to a different reconciliation report.",
    );
  }
  const expectedToken = manifestApprovalToken(manifest);
  const decisionById = new Map(
    manifest.insertionDecisions.map((decision) => [
      decision.sourceRecordId,
      decision,
    ]),
  );
  const accountByKey = new Map(
    manifest.accountDecisions.map((decision) => [
      decision.statementAccountKey,
      decision,
    ]),
  );
  const dateByKey = new Map(
    manifest.dateDecisions.map((decision) => [
      decision.statementAccountKey,
      decision,
    ]),
  );
  const eligible = report.proposedInsertions.filter((row) =>
    matchesFilters(row, filters),
  );
  const approved = [];
  const excluded = [];
  for (const row of eligible) {
    const decision = decisionById.get(row.sourceRecordId);
    const account = accountByKey.get(row.statementAccountKey);
    const date = dateByKey.get(row.statementAccountKey);
    const reasons = [];
    if (!decision) reasons.push("missing_insertion_decision");
    else {
      if (decision.rowFingerprint !== rowFingerprint(row))
        reasons.push("row_fingerprint_changed");
      if (decision.decision !== "approved")
        reasons.push(`row_${decision.decision}`);
    }
    if (account?.decision !== "approved")
      reasons.push("account_mapping_not_approved");
    if (date?.decision !== "approved") reasons.push("date_policy_not_approved");
    if (reasons.length === 0) approved.push(row);
    else excluded.push({ sourceRecordId: row.sourceRecordId, reasons });
  }
  return {
    expectedToken,
    eligible,
    approved,
    excluded,
    totals: {
      eligible: eligible.length,
      approved: approved.length,
      excluded: excluded.length,
      approvedAmount: roundMoney(
        approved.reduce((sum, row) => sum + Number(row.amount), 0),
      ),
    },
  };
}

async function fetchByExternalIds(supabase, externalIds) {
  if (externalIds.length === 0) return [];
  const { data, error } = await supabase
    .from("transactions")
    .select(
      "id,date,description,amount,account_id,connection_provider,external_transaction_id,upload_source,user_id",
    )
    .eq("connection_provider", "statement")
    .in("external_transaction_id", externalIds);
  if (error) throw error;
  return data ?? [];
}

function compareAppliedRows(expectedRows, actualRows) {
  const actualByExternalId = new Map(
    actualRows.map((row) => [row.external_transaction_id, row]),
  );
  const errors = [];
  for (const expected of expectedRows) {
    const actual = actualByExternalId.get(expected.externalTransactionId);
    if (!actual) {
      errors.push({
        externalTransactionId: expected.externalTransactionId,
        reason: "missing_after_apply",
      });
      continue;
    }
    for (const [field, expectedValue, actualValue] of [
      ["date", expected.insertRecord.date, actual.date],
      ["description", expected.insertRecord.description, actual.description],
      ["amount", Number(expected.insertRecord.amount), Number(actual.amount)],
      ["account_id", expected.insertRecord.account_id, actual.account_id],
      ["user_id", expected.insertRecord.user_id, actual.user_id],
    ]) {
      if (expectedValue !== actualValue) {
        errors.push({
          externalTransactionId: expected.externalTransactionId,
          field,
          expected: expectedValue,
          actual: actualValue,
        });
      }
    }
  }
  return errors;
}

export async function applyApprovedBatch({
  supabase,
  report,
  manifest,
  approval,
  filters = {},
}) {
  const validation = validateReviewManifest(report, manifest, filters);
  if (approval !== validation.expectedToken)
    throw new Error("Approval token mismatch.");
  if (
    !validation.approved.length ||
    validation.approved.length > MAX_BATCH_SIZE
  )
    throw new Error("Choose 1–250 explicitly reviewed rows.");
  const filterIdentity = JSON.stringify({
    account: filters.account ?? null,
    year: filters.year ?? null,
    month: filters.month ?? null,
  });
  const batchId =
    "stmtbatch_" +
    stableHash(report.reportId + "|" + approval + "|" + filterIdentity).slice(
      0,
      24,
    );
  const items = validation.approved.map((row) => ({
    ...row.insertRecord,
    connection_provider: "statement",
    external_transaction_id: row.externalTransactionId,
  }));
  const { data, error } = await supabase.rpc(
    "stackmint_import_statement_batch",
    {
      p_user_id: report.supabaseUserId,
      p_batch_id: batchId,
      p_report_id: report.reportId,
      p_items: items,
    },
  );
  if (error)
    throw new Error(
      "Batch result unavailable. Retry the same approved batch to recover its durable receipt; do not assume rollback.",
    );
  return {
    ...data,
    externalTransactionIds: items.map((row) => row.external_transaction_id),
    expectedRows: validation.approved.map((row) => ({
      externalTransactionId: row.externalTransactionId,
      insertRecord: row.insertRecord,
    })),
  };
}

export async function verifyBatchReceipt({ supabase, report, receipt }) {
  let expectedRows = receipt.expectedRows;
  if (!expectedRows) {
    if (!report || receipt.reportId !== report.reportId) {
      throw new Error(
        "Legacy receipt requires its original reconciliation report.",
      );
    }
    const expectedByExternalId = new Map(
      report.proposedInsertions.map((row) => [row.externalTransactionId, row]),
    );
    expectedRows = receipt.externalTransactionIds.map((externalId) => {
      const row = expectedByExternalId.get(externalId);
      if (!row)
        throw new Error(
          `Receipt references unknown external ID ${externalId}.`,
        );
      return row;
    });
  }
  const actualRows = await fetchByExternalIds(
    supabase,
    receipt.externalTransactionIds,
  );
  const errors = compareAppliedRows(expectedRows, actualRows);
  return {
    batchId: receipt.batchId,
    expected: expectedRows.length,
    found: actualRows.length,
    status:
      errors.length === 0 && actualRows.length === expectedRows.length
        ? "passed"
        : "failed",
    errors,
  };
}

export async function rollbackBatchReceipt({ supabase, receipt, approval }) {
  if (approval !== "archive:" + receipt.batchId)
    throw new Error(
      "Archive approval token required. This operation preserves records and can be reversed.",
    );
  if (receipt.schemaVersion !== 2 || !receipt.userId)
    throw new Error(
      "Legacy receipts require individual review; they cannot prove later edits are absent.",
    );
  const { data, error } = await supabase.rpc(
    "stackmint_archive_statement_batch",
    { p_user_id: receipt.userId, p_batch_id: receipt.batchId },
  );
  if (error)
    throw new Error(
      "Could not archive the batch. Changed records must be reviewed individually; no records were deleted.",
    );
  return { batchId: receipt.batchId, archived: data, deleted: 0 };
}
