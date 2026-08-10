import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  descriptionForMatching,
  parseStatementFile,
  stableHash,
} from "./statement-parser.mjs";

const DATE_TOLERANCE_DAYS = 3;
const POSSIBLE_DATE_TOLERANCE_DAYS = 5;

function parseEnvText(text) {
  const result = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[line.slice(0, index).trim()] = value;
  }
  return result;
}

export async function loadEnvironment(repoRoot) {
  let fileEnv = {};
  try {
    fileEnv = parseEnvText(await fs.readFile(path.join(repoRoot, ".env.local"), "utf8"));
  } catch {
    // Environment variables may be supplied by the caller instead.
  }
  return { ...fileEnv, ...process.env };
}

export function createSupabase(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for reconciliation."
    );
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function fetchAll(queryFactory, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await queryFactory().range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

export async function loadSupabaseSnapshot(supabase, explicitUserId) {
  let userId = explicitUserId;
  if (!userId) {
    const { data, error } = await supabase
      .from("accounts")
      .select("user_id")
      .not("user_id", "is", null)
      .limit(2);
    if (error) throw error;
    const userIds = [...new Set((data ?? []).map((row) => row.user_id).filter(Boolean))];
    if (userIds.length !== 1) {
      throw new Error(
        `Expected exactly one Supabase user with accounts; found ${userIds.length}. Set STATEMENT_IMPORT_USER_ID.`
      );
    }
    [userId] = userIds;
  }

  const accounts = await fetchAll(() =>
    supabase
      .from("accounts")
      .select(
        "id,user_id,name,institution,type,connection_provider,external_account_id,plaid_account_id,hidden"
      )
      .eq("user_id", userId)
      .order("institution")
      .order("name")
  );
  const transactions = await fetchAll(() =>
    supabase
      .from("transactions")
      .select(
        "id,user_id,date,description,amount,account_id,category_id,status,source,upload_source,connection_provider,external_transaction_id,external_status,parent_id,is_split,not_duplicate,created_at"
      )
      .eq("user_id", userId)
      .is("parent_id", null)
      .or("external_status.is.null,external_status.neq.removed")
      .order("date")
      .order("created_at")
  );
  return { userId, accounts, transactions };
}

function accountLast4(account) {
  const match = account.name?.match(/(?:\.\.\.|x{2,}|ending in\s*)(\d{4})/i);
  return match?.[1] ?? null;
}

function accountTypeKey(account) {
  const value = account.type?.toLowerCase() ?? "";
  if (value.includes("credit")) return "credit_card";
  if (value.includes("saving")) return "savings";
  if (value.includes("checking")) return "checking";
  return value.replace(/\s+/g, "_");
}

function institutionMatches(statementInstitution, accountInstitution) {
  const value = accountInstitution.toLowerCase();
  if (statementInstitution === "capital_one") return value.includes("capital one");
  if (statementInstitution === "ally") return value.includes("ally");
  if (statementInstitution === "grasshopper") return value.includes("grasshopper");
  return value.includes(statementInstitution.replaceAll("_", " "));
}

function accountTransactionCounts(transactions) {
  const counts = new Map();
  for (const transaction of transactions) {
    if (!transaction.account_id) continue;
    counts.set(transaction.account_id, (counts.get(transaction.account_id) ?? 0) + 1);
  }
  return counts;
}

export function mapStatementAccounts(statementAccountKeys, accounts, transactions) {
  const counts = accountTransactionCounts(transactions);
  const mappings = [];
  for (const statementAccountKey of [...statementAccountKeys].sort()) {
    const [institution, type, last4] = statementAccountKey.split(":");
    const candidates = accounts
      .filter(
        (account) =>
          institutionMatches(institution, account.institution ?? "") &&
          accountTypeKey(account) === type &&
          accountLast4(account) === last4
      )
      .map((account) => ({ ...account, transactionCount: counts.get(account.id) ?? 0 }))
      .sort(
        (a, b) =>
          Number(a.hidden) - Number(b.hidden) ||
          b.transactionCount - a.transactionCount ||
          a.id.localeCompare(b.id)
      );

    let status = "unmapped";
    let accountId = null;
    let rationale = "No existing account matched institution, type, and last four digits.";
    if (candidates.length === 1) {
      status = "mapped";
      accountId = candidates[0].id;
      rationale = "Unique institution, account type, and last-four match.";
    } else if (candidates.length > 1) {
      const visible = candidates.filter((candidate) => !candidate.hidden);
      if (visible.length === 1) {
        status = "mapped";
        accountId = visible[0].id;
        rationale =
          "Multiple historical account records share the same last four; selected the only visible account.";
      } else {
        status = "uncertain";
        rationale =
          "Multiple visible account records share the same institution, type, and last four digits; no automatic mapping was made.";
      }
    }
    mappings.push({
      statementAccountKey,
      status,
      accountId,
      rationale,
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        institution: candidate.institution,
        type: candidate.type,
        hidden: candidate.hidden,
        connectionProvider: candidate.connection_provider,
        transactionCount: candidate.transactionCount,
      })),
    });
  }
  return mappings;
}

function dateNumber(value) {
  return Date.parse(`${value}T00:00:00Z`) / 86_400_000;
}

function dateDistance(a, b) {
  return Math.abs(dateNumber(a) - dateNumber(b));
}

function tokenSet(value) {
  return new Set(
    descriptionForMatching(value)
      .split(" ")
      .filter((token) => token.length > 1)
  );
}

function jaccard(a, b) {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function bigrams(value) {
  const normalized = descriptionForMatching(value).replaceAll(" ", "");
  const result = new Set();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    result.add(normalized.slice(index, index + 2));
  }
  return result;
}

function dice(a, b) {
  const left = bigrams(a);
  const right = bigrams(b);
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const pair of left) if (right.has(pair)) intersection += 1;
  return (2 * intersection) / (left.size + right.size);
}

export function descriptionSimilarity(a, b) {
  const normalizedA = descriptionForMatching(a);
  const normalizedB = descriptionForMatching(b);
  if (normalizedA && normalizedA === normalizedB) return 1;
  if (!normalizedA || !normalizedB) return 0;
  const compactA = normalizedA.replaceAll(" ", "");
  const compactB = normalizedB.replaceAll(" ", "");
  const shorter = compactA.length <= compactB.length ? compactA : compactB;
  const longer = compactA.length <= compactB.length ? compactB : compactA;
  if (shorter.length >= 5 && longer.startsWith(shorter)) return 0.92;
  return Math.max(jaccard(normalizedA, normalizedB), dice(normalizedA, normalizedB));
}

function dateEvidence(statement, existing) {
  const transactionDistance = dateDistance(statement.transactionDate, existing.date);
  const postedDistance = statement.postedDate
    ? dateDistance(statement.postedDate, existing.date)
    : Number.POSITIVE_INFINITY;
  return {
    distance: Math.min(transactionDistance, postedDistance),
    matchedDate:
      postedDistance < transactionDistance ? statement.postedDate : statement.transactionDate,
  };
}

function candidateRecord(statement, existing) {
  const dates = dateEvidence(statement, existing);
  const amountDelta = Math.abs(Number(existing.amount) - statement.amount);
  const similarity = descriptionSimilarity(statement.description, existing.description ?? "");
  return {
    id: existing.id,
    accountId: existing.account_id,
    date: existing.date,
    description: existing.description,
    amount: Number(existing.amount),
    source: existing.source,
    uploadSource: existing.upload_source,
    connectionProvider: existing.connection_provider,
    externalTransactionId: existing.external_transaction_id,
    amountDelta,
    dateDistanceDays: dates.distance,
    matchedStatementDate: dates.matchedDate,
    descriptionSimilarity: Math.round(similarity * 1000) / 1000,
  };
}

function exactCandidate(candidate) {
  return (
    candidate.amountDelta < 0.005 &&
    candidate.dateDistanceDays === 0 &&
    candidate.descriptionSimilarity === 1
  );
}

function highCandidate(candidate) {
  return (
    candidate.amountDelta < 0.005 &&
    candidate.dateDistanceDays <= DATE_TOLERANCE_DAYS &&
    candidate.descriptionSimilarity >= 0.72
  );
}

function possibleCandidate(candidate) {
  return (
    candidate.amountDelta < 0.005 &&
    candidate.dateDistanceDays <= POSSIBLE_DATE_TOLERANCE_DAYS &&
    candidate.descriptionSimilarity >= 0.34
  );
}

function conflictCandidate(candidate) {
  return (
    candidate.amountDelta >= 0.005 &&
    candidate.dateDistanceDays <= DATE_TOLERANCE_DAYS &&
    candidate.descriptionSimilarity >= 0.72
  );
}

function matchReason(kind, candidate) {
  if (kind === "exact_match") {
    return "Same account, signed amount, normalized description, and transaction/posted date.";
  }
  if (kind === "high_confidence_match") {
    return `Same account and signed amount; description similarity ${candidate.descriptionSimilarity}; date difference ${candidate.dateDistanceDays} day(s).`;
  }
  if (kind === "possible_match") {
    return `Same account and signed amount with weaker evidence: description similarity ${candidate.descriptionSimilarity}; date difference ${candidate.dateDistanceDays} day(s).`;
  }
  return `Strong account/date/description evidence but amount differs by ${candidate.amountDelta.toFixed(2)}.`;
}

function reportStatementRow(statement, mapping) {
  return {
    sourceRecordId: statement.sourceRecordId,
    statementAccountKey: statement.statementAccountKey,
    mappedAccountId: mapping?.accountId ?? null,
    transactionDate: statement.transactionDate,
    postedDate: statement.postedDate,
    amount: statement.amount,
    description: statement.description,
    statementFile: statement.statementFile,
    statementPeriodStart: statement.statementPeriodStart,
    statementPeriodEnd: statement.statementPeriodEnd,
    page: statement.page,
    rowReference: statement.rowReference,
    confidence: statement.confidence,
  };
}

function isStatementImport(transaction) {
  return (
    transaction.connection_provider === "statement" ||
    transaction.source === "statement" ||
    transaction.external_transaction_id?.startsWith("stmt_") ||
    transaction.upload_source?.startsWith("statement:")
  );
}

export function buildReconciliationWindows(mappings, existingTransactions) {
  return mappings.map((mapping) => {
    const accountIds = [mapping.accountId, ...(mapping.aliasAccountIds ?? [])].filter(Boolean);
    const dates = existingTransactions
      .filter(
        (transaction) =>
          accountIds.includes(transaction.account_id) && !isStatementImport(transaction)
      )
      .map((transaction) => transaction.date)
      .filter(Boolean)
      .sort();
    return {
      statementAccountKey: mapping.statementAccountKey,
      accountIds,
      firstExistingDate: dates[0] ?? null,
      lastExistingDate: dates.at(-1) ?? null,
      existingTransactionCount: dates.length,
    };
  });
}

export function isWithinReconciliationWindow(statement, window) {
  if (!window?.firstExistingDate || !window.lastExistingDate) return false;
  return [statement.transactionDate, statement.postedDate]
    .filter(Boolean)
    .some(
      (date) => date >= window.firstExistingDate && date <= window.lastExistingDate
    );
}

function statementIdentityKey(statement) {
  return [
    statement.statementAccountKey,
    statement.transactionDate,
    statement.postedDate ?? "",
    statement.amount.toFixed(2),
    statement.normalizedDescription,
  ].join("|");
}

function consolidateStatementTransactions(files) {
  const fileHashOwner = new Map();
  const duplicateFiles = [];
  const canonicalFiles = [];
  for (const file of [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
    const owner = fileHashOwner.get(file.fileHash);
    if (owner) {
      duplicateFiles.push({
        statementFile: file.relativePath,
        duplicateOf: owner,
        fileHash: file.fileHash,
        reason: "Byte-for-byte duplicate statement file; excluded from transaction totals.",
      });
    } else {
      fileHashOwner.set(file.fileHash, file.relativePath);
      canonicalFiles.push(file);
    }
  }

  const grouped = new Map();
  for (const file of canonicalFiles) {
    for (const transaction of file.transactions) {
      const key = statementIdentityKey(transaction);
      const fileGroup = grouped.get(key) ?? new Map();
      const rows = fileGroup.get(file.relativePath) ?? [];
      rows.push(transaction);
      fileGroup.set(file.relativePath, rows);
      grouped.set(key, fileGroup);
    }
  }

  const transactions = [];
  const overlappingRows = [];
  for (const [key, byFile] of grouped) {
    const ranked = [...byFile.entries()].sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])
    );
    transactions.push(...ranked[0][1]);
    for (const [fileName, rows] of ranked.slice(1)) {
      overlappingRows.push({
        ...reportStatementRow(rows[0], null),
        identityKey: key,
        statementFile: fileName,
        duplicateOf: ranked[0][0],
        occurrencesExcluded: Math.min(rows.length, ranked[0][1].length),
        reason: "Identical statement transaction also appeared in an overlapping statement period.",
      });
    }
  }
  return { canonicalFiles, transactions, duplicateFiles, overlappingRows };
}

function assignMatches(
  statementTransactions,
  mappings,
  existingTransactions,
  usedExistingIds = new Set()
) {
  const mappingByKey = new Map(mappings.map((mapping) => [mapping.statementAccountKey, mapping]));
  const existingByAccount = new Map();
  for (const transaction of existingTransactions) {
    const rows = existingByAccount.get(transaction.account_id) ?? [];
    rows.push(transaction);
    existingByAccount.set(transaction.account_id, rows);
  }

  const exactMatches = [];
  const highConfidenceMatches = [];
  const possibleMatches = [];
  const conflicts = [];
  const missing = [];
  const unmappedTransactions = [];
  const duplicateCandidates = [];

  const sorted = [...statementTransactions].sort(
    (a, b) =>
      a.transactionDate.localeCompare(b.transactionDate) ||
      a.statementAccountKey.localeCompare(b.statementAccountKey) ||
      a.sourceOccurrence - b.sourceOccurrence
  );

  for (const statement of sorted) {
    const mapping = mappingByKey.get(statement.statementAccountKey);
    if (!mapping || mapping.status !== "mapped" || !mapping.accountId) {
      unmappedTransactions.push({
        ...reportStatementRow(statement, mapping),
        reason: mapping?.rationale ?? "No account mapping exists.",
        candidateAccountIds: mapping?.candidates.map((candidate) => candidate.id) ?? [],
      });
      continue;
    }

    const accountIds = [mapping.accountId, ...(mapping.aliasAccountIds ?? [])];
    const accountRows = accountIds.flatMap((accountId) => existingByAccount.get(accountId) ?? []);
    const candidates = accountRows
      .filter((existing) => {
        const dates = dateEvidence(statement, existing);
        return dates.distance <= 7;
      })
      .map((existing) => candidateRecord(statement, existing))
      .sort(
        (a, b) =>
          a.amountDelta - b.amountDelta ||
          a.dateDistanceDays - b.dateDistanceDays ||
          b.descriptionSimilarity - a.descriptionSimilarity ||
          a.id.localeCompare(b.id)
      );

    const unusedExact = candidates.filter(
      (candidate) => exactCandidate(candidate) && !usedExistingIds.has(candidate.id)
    );
    if (unusedExact.length > 0) {
      const selected = unusedExact[0];
      usedExistingIds.add(selected.id);
      exactMatches.push({
        ...reportStatementRow(statement, mapping),
        supabaseTransactionId: selected.id,
        reason: matchReason("exact_match", selected),
        candidate: selected,
      });
      if (unusedExact.length > 1) {
        duplicateCandidates.push({
          ...reportStatementRow(statement, mapping),
          matchedSupabaseTransactionId: selected.id,
          candidateSupabaseTransactionIds: unusedExact.slice(1).map((candidate) => candidate.id),
          reason:
            "More exact Supabase rows exist than this statement occurrence; extras are likely duplicates but were not changed.",
        });
      }
      continue;
    }

    const unusedHigh = candidates.filter(
      (candidate) => highCandidate(candidate) && !usedExistingIds.has(candidate.id)
    );
    if (unusedHigh.length > 0) {
      const selected = unusedHigh[0];
      const runnerUp = unusedHigh[1];
      const uniqueEnough =
        !runnerUp ||
        selected.dateDistanceDays < runnerUp.dateDistanceDays ||
        selected.descriptionSimilarity - runnerUp.descriptionSimilarity >= 0.15;
      if (uniqueEnough) {
        usedExistingIds.add(selected.id);
        highConfidenceMatches.push({
          ...reportStatementRow(statement, mapping),
          supabaseTransactionId: selected.id,
          reason: matchReason("high_confidence_match", selected),
          candidate: selected,
        });
        continue;
      }
    }

    const possible = candidates.filter(
      (candidate) => possibleCandidate(candidate) && !usedExistingIds.has(candidate.id)
    );
    if (possible.length > 0) {
      possibleMatches.push({
        ...reportStatementRow(statement, mapping),
        candidateSupabaseTransactionIds: possible.map((candidate) => candidate.id),
        reason: matchReason("possible_match", possible[0]),
        candidates: possible.slice(0, 10),
      });
      continue;
    }

    const conflicting = candidates.filter((candidate) => conflictCandidate(candidate));
    if (conflicting.length > 0) {
      conflicts.push({
        ...reportStatementRow(statement, mapping),
        candidateSupabaseTransactionIds: conflicting.map((candidate) => candidate.id),
        reason: matchReason("conflict", conflicting[0]),
        candidates: conflicting.slice(0, 10),
      });
      continue;
    }

    missing.push(reportStatementRow(statement, mapping));
  }

  return {
    usedExistingIds,
    exactMatches,
    highConfidenceMatches,
    possibleMatches,
    conflicts,
    missing,
    unmappedTransactions,
    duplicateCandidates,
  };
}

function monthsBetween(start, end) {
  if (!start || !end) return [];
  const result = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7));
  const endYear = Number(end.slice(0, 4));
  const endMonth = Number(end.slice(5, 7));
  while (year < endYear || (year === endYear && month <= endMonth)) {
    result.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return result;
}

function coverageReport(files, statementAccountKeys, throughDate) {
  const allMonths = monthsBetween("2023-01-01", throughDate);
  const byAccount = [];
  for (const key of [...statementAccountKeys].sort()) {
    const accountFiles = files.filter((file) => file.statementAccountKeys.includes(key));
    const covered = new Set();
    for (const file of accountFiles) {
      for (const month of monthsBetween(file.periodStart, file.periodEnd)) covered.add(month);
    }
    const missing = allMonths.filter((month) => !covered.has(month));
    byAccount.push({
      statementAccountKey: key,
      statementFiles: accountFiles.length,
      firstPeriodStart: accountFiles.map((file) => file.periodStart).filter(Boolean).sort()[0] ?? null,
      lastPeriodEnd: accountFiles.map((file) => file.periodEnd).filter(Boolean).sort().at(-1) ?? null,
      coveredMonths: [...covered].sort(),
      missingMonths: missing,
      coverageComplete: missing.length === 0,
    });
  }
  return byAccount;
}

function existingNotInStatements(
  existingTransactions,
  mappings,
  coverage,
  usedExistingIds
) {
  const coveredByAccountId = new Map();
  for (const mapping of mappings) {
    if (mapping.status !== "mapped" || !mapping.accountId) continue;
    const accountCoverage = coverage.find(
      (item) => item.statementAccountKey === mapping.statementAccountKey
    );
    if (!accountCoverage) continue;
    for (const accountId of [mapping.accountId, ...(mapping.aliasAccountIds ?? [])]) {
      const months = coveredByAccountId.get(accountId) ?? new Set();
      for (const month of accountCoverage.coveredMonths) months.add(month);
      coveredByAccountId.set(accountId, months);
    }
  }
  return existingTransactions
    .filter(
      (transaction) =>
        !usedExistingIds.has(transaction.id) &&
        coveredByAccountId.get(transaction.account_id)?.has(transaction.date.slice(0, 7))
    )
    .map((transaction) => ({
      supabaseTransactionId: transaction.id,
      accountId: transaction.account_id,
      date: transaction.date,
      amount: Number(transaction.amount),
      description: transaction.description,
      source: transaction.source,
      uploadSource: transaction.upload_source,
      connectionProvider: transaction.connection_provider,
      externalTransactionId: transaction.external_transaction_id,
      reason: "No statement transaction was confidently assigned to this Supabase transaction within a covered month.",
    }));
}

function groupSummary(rows, accountField = "statementAccountKey") {
  const grouped = new Map();
  for (const row of rows) {
    const year = (row.transactionDate ?? row.date)?.slice(0, 4) ?? "unknown";
    const account = row[accountField] ?? row.mappedAccountId ?? row.accountId ?? "unknown";
    const key = `${year}|${account}`;
    const entry = grouped.get(key) ?? { year, account, count: 0, totalAmount: 0 };
    entry.count += 1;
    entry.totalAmount = Math.round((entry.totalAmount + Number(row.amount ?? 0)) * 100) / 100;
    grouped.set(key, entry);
  }
  return [...grouped.values()].sort(
    (a, b) => a.year.localeCompare(b.year) || a.account.localeCompare(b.account)
  );
}

function inferDatePolicies(matches, statementAccountKeys) {
  const matchedRows = [...matches.exactMatches, ...matches.highConfidenceMatches];
  return [...statementAccountKeys].sort().map((statementAccountKey) => {
    const rows = matchedRows.filter(
      (row) => row.statementAccountKey === statementAccountKey && row.postedDate
    );
    const distinctDateRows = rows.filter((row) => row.transactionDate !== row.postedDate);
    const transactionDateMatches = distinctDateRows.filter(
      (row) => row.candidate?.date === row.transactionDate
    ).length;
    const postedDateMatches = distinctDateRows.filter(
      (row) => row.candidate?.date === row.postedDate
    ).length;
    const policy =
      postedDateMatches > transactionDateMatches ? "posted_date" : "transaction_date";
    const decisiveMatches = Math.max(transactionDateMatches, postedDateMatches);
    const evidenceRows = distinctDateRows.length;
    const agreement = evidenceRows === 0 ? 1 : decisiveMatches / evidenceRows;
    return {
      statementAccountKey,
      policy,
      status: evidenceRows >= 5 && agreement >= 0.9 ? "evidence_confirmed" : "defaulted",
      matchedRowsWithPostedDate: rows.length,
      distinctDateEvidenceRows: evidenceRows,
      transactionDateMatches,
      postedDateMatches,
      agreement: Math.round(agreement * 10000) / 10000,
      rationale:
        evidenceRows === 0
          ? "No distinct posted-date evidence was available; use the statement transaction date."
          : `${decisiveMatches} of ${evidenceRows} matched rows with distinct dates agree with ${policy.replaceAll("_", " ")}.`,
    };
  });
}

function proposedRows(
  missing,
  mappings,
  accounts,
  userId,
  datePolicies,
  existingTransactions = []
) {
  const mappingByKey = new Map(mappings.map((mapping) => [mapping.statementAccountKey, mapping]));
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const datePolicyByKey = new Map(
    datePolicies.map((policy) => [policy.statementAccountKey, policy])
  );
  const occurrences = new Map();
  const existingExternalIds = new Set(
    existingTransactions
      .map((transaction) => transaction.external_transaction_id)
      .filter(Boolean)
  );
  return missing.map((row) => {
    const mapping = mappingByKey.get(row.statementAccountKey);
    const account = accountsById.get(mapping.accountId);
    const datePolicy = datePolicyByKey.get(row.statementAccountKey);
    const appliedDate =
      datePolicy?.policy === "posted_date" && row.postedDate
        ? row.postedDate
        : row.transactionDate;
    const identityBase = [
      mapping.accountId,
      appliedDate,
      row.postedDate ?? "",
      Number(row.amount).toFixed(2),
      descriptionForMatching(row.description),
    ].join("|");
    const occurrence = (occurrences.get(identityBase) ?? 0) + 1;
    occurrences.set(identityBase, occurrence);
    const legacyExternalId = `stmt_${stableHash(`${identityBase}|${occurrence}`).slice(0, 48)}`;
    // Older imports numbered otherwise-identical rows only within the then-missing
    // set. If an earlier row is matched on a later run, that numbering can be
    // reused by a different legitimate occurrence. Preserve compatibility with
    // existing IDs, but give the remaining statement row its own stable identity.
    const externalId = existingExternalIds.has(legacyExternalId)
      ? `stmt_${stableHash(`source|${row.sourceRecordId}`).slice(0, 48)}`
      : legacyExternalId;
    return {
      ...row,
      appliedDate,
      datePolicy: datePolicy?.policy ?? "transaction_date",
      externalTransactionId: externalId,
      insertRecord: {
        date: appliedDate,
        description: row.description,
        amount: row.amount,
        account_id: mapping.accountId,
        account: account?.name ?? null,
        status: "Unconfirmed",
        source: "statement",
        upload_source: `statement:${row.statementFile}`,
        connection_provider: "statement",
        external_transaction_id: externalId,
        external_status: "posted",
        not_duplicate: false,
        user_id: userId,
      },
    };
  });
}

async function listPdfFiles(root) {
  const result = [];
  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) result.push(fullPath);
    }
  }
  await visit(root);
  return result;
}

export async function parseAllStatements(statementsRoot, onProgress = () => {}) {
  const filePaths = await listPdfFiles(statementsRoot);
  const files = [];
  const parsingFailures = [];
  for (let index = 0; index < filePaths.length; index += 1) {
    const filePath = filePaths[index];
    onProgress({ index: index + 1, total: filePaths.length, filePath });
    try {
      const parsed = await parseStatementFile(filePath, statementsRoot);
      files.push(parsed);
      for (const warning of parsed.warnings) {
        const validationFailures = parsed.validations?.filter(
          (validation) => validation.status === "fail"
        );
        parsingFailures.push({
          statementFile: parsed.relativePath,
          parser: parsed.parser,
          warning,
          reason:
            warning === "no_transactions_parsed"
              ? "No transaction rows were parsed; this may be a zero-activity statement or a parsing failure."
              : warning === "statement_balance_validation_failed"
                ? `Parsed transaction total did not reconcile to the statement summary: ${JSON.stringify(validationFailures)}`
                : warning === "statement_balance_not_validated"
                  ? "The parser could not extract a statement-level balance/activity total for an automated tie-out."
                  : warning,
        });
      }
    } catch (error) {
      parsingFailures.push({
        statementFile: path.relative(statementsRoot, filePath).replaceAll("\\", "/"),
        parser: null,
        warning: "exception",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { files, parsingFailures, totalPdfFiles: filePaths.length };
}

export async function buildReconciliationReport({
  statementsRoot,
  snapshot,
  parsed,
  throughDate,
  reviewManifest = null,
}) {
  const consolidated = consolidateStatementTransactions(parsed.files);
  const inRangeTransactions = consolidated.transactions.filter(
    (transaction) =>
      transaction.transactionDate >= "2023-01-01" &&
      transaction.transactionDate <= throughDate
  );
  const excludedOutsideRequestedRange = consolidated.transactions.filter(
    (transaction) =>
      transaction.transactionDate < "2023-01-01" ||
      transaction.transactionDate > throughDate
  );
  const statementAccountKeys = new Set(
    parsed.files.flatMap((file) => file.statementAccountKeys)
  );
  const mappings = mapStatementAccounts(
    statementAccountKeys,
    snapshot.accounts,
    snapshot.transactions
  );
  for (const mapping of mappings) {
    const observed = new Set(
      parsed.files
        .filter((file) => file.statementAccountKeys.includes(mapping.statementAccountKey))
        .flatMap((file) => file.detectedAccountLast4s ?? [])
    );
    mapping.observedStatementLast4s = [...observed].sort();
    const mappedLast4 = mapping.statementAccountKey.split(":").at(-1);
    const historicalLast4s = mapping.observedStatementLast4s.filter(
      (last4) => last4 !== mappedLast4
    );
    if (mapping.statementAccountKey.includes(":credit_card:") && historicalLast4s.length > 0) {
      mapping.confirmationRequired = true;
      mapping.rationale += ` The statement sequence also contains historical card numbers ending ${historicalLast4s.join(", ")}; these are treated as card-number rotations within the supplied account folder and should be confirmed before apply.`;
    } else {
      mapping.confirmationRequired = false;
    }
  }
  if (reviewManifest?.accountDecisions) {
    const accountIds = new Set(snapshot.accounts.map((account) => account.id));
    const decisions = new Map(
      reviewManifest.accountDecisions.map((decision) => [
        decision.statementAccountKey,
        decision,
      ])
    );
    for (const mapping of mappings) {
      const decision = decisions.get(mapping.statementAccountKey);
      if (!decision || decision.decision !== "approved") continue;
      if (!decision.approvedAccountId || !accountIds.has(decision.approvedAccountId)) {
        throw new Error(
          `Approved account decision for ${mapping.statementAccountKey} has an invalid account ID.`
        );
      }
      const aliasAccountIds = [...new Set(decision.aliasAccountIds ?? [])];
      if (aliasAccountIds.some((accountId) => !accountIds.has(accountId))) {
        throw new Error(
          `Approved account decision for ${mapping.statementAccountKey} has an invalid alias account ID.`
        );
      }
      mapping.status = "mapped";
      mapping.accountId = decision.approvedAccountId;
      mapping.aliasAccountIds = aliasAccountIds.filter(
        (accountId) => accountId !== decision.approvedAccountId
      );
      mapping.confirmationRequired = false;
      mapping.rationale += ` Confirmed by review manifest ${reviewManifest.reportId ?? "unversioned"}.`;
    }
  }
  const coverage = coverageReport(
    consolidated.canonicalFiles,
    statementAccountKeys,
    throughDate
  );
  const reconciliationWindows = buildReconciliationWindows(
    mappings,
    snapshot.transactions
  );
  const windowByKey = new Map(
    reconciliationWindows.map((window) => [window.statementAccountKey, window])
  );
  const mappingByKey = new Map(
    mappings.map((mapping) => [mapping.statementAccountKey, mapping])
  );
  const reconciliationTransactions = [];
  const automaticTransactions = [];
  for (const transaction of inRangeTransactions) {
    const mapping = mappingByKey.get(transaction.statementAccountKey);
    if (!mapping || mapping.status !== "mapped" || !mapping.accountId) {
      reconciliationTransactions.push(transaction);
    } else if (
      isWithinReconciliationWindow(
        transaction,
        windowByKey.get(transaction.statementAccountKey)
      )
    ) {
      reconciliationTransactions.push(transaction);
    } else {
      automaticTransactions.push(transaction);
    }
  }
  const usedExistingIds = new Set();
  const matches = assignMatches(
    reconciliationTransactions,
    mappings,
    snapshot.transactions,
    usedExistingIds
  );
  const automaticMatches = assignMatches(
    automaticTransactions,
    mappings,
    snapshot.transactions,
    usedExistingIds
  );
  const outsideOverlapExceptions = [
    ...automaticMatches.possibleMatches,
    ...automaticMatches.conflicts,
    ...automaticMatches.duplicateCandidates,
  ].map((row) => ({
    ...row,
    reconciliationRequired: false,
    reason: `${row.reason} Kept out of the reconciliation queue because the statement date is outside the original Supabase history window.`,
  }));
  matches.exactMatches.push(
    ...automaticMatches.exactMatches.map((row) => ({
      ...row,
      reconciliationRequired: false,
    }))
  );
  matches.highConfidenceMatches.push(
    ...automaticMatches.highConfidenceMatches.map((row) => ({
      ...row,
      reconciliationRequired: false,
    }))
  );
  matches.missing.push(
    ...automaticMatches.missing.map((row) => ({
      ...row,
      reconciliationRequired: false,
      reason:
        "No reconciliation required: the statement date is outside the original Supabase history window.",
    }))
  );
  matches.usedExistingIds = usedExistingIds;
  const datePolicies = inferDatePolicies(
    {
      exactMatches: matches.exactMatches.filter(
        (row) => row.reconciliationRequired !== false
      ),
      highConfidenceMatches: matches.highConfidenceMatches.filter(
        (row) => row.reconciliationRequired !== false
      ),
    },
    statementAccountKeys
  );
  const safeStatementFiles = new Set(
    parsed.files
      .filter(
        (file) =>
          file.parser !== "unknown" &&
          file.periodStart &&
          file.periodEnd &&
          file.validations?.length > 0 &&
          file.validations.every((validation) => validation.status === "pass")
      )
      .map((file) => file.relativePath)
  );
  const approvedMappingKeys = new Set(
    mappings
      .filter(
        (mapping) =>
          mapping.status === "mapped" &&
          mapping.accountId &&
          !mapping.confirmationRequired
      )
      .map((mapping) => mapping.statementAccountKey)
  );
  const proposedInsertions = proposedRows(
    matches.missing.filter(
      (row) =>
        safeStatementFiles.has(row.statementFile) &&
        approvedMappingKeys.has(row.statementAccountKey)
    ),
    mappings,
    snapshot.accounts,
    snapshot.userId,
    datePolicies,
    snapshot.transactions
  );
  const automaticInsertions = proposedInsertions.filter(
    (row) => row.reconciliationRequired === false
  );
  const reconciliationInsertions = proposedInsertions.filter(
    (row) => row.reconciliationRequired !== false
  );
  const unmatchedExisting = existingNotInStatements(
    snapshot.transactions,
    mappings,
    coverage,
    matches.usedExistingIds
  );
  const parsingFailures = [
    ...parsed.parsingFailures,
    ...consolidated.duplicateFiles.map((duplicate) => ({
      ...duplicate,
      warning: "duplicate_file_content",
    })),
  ];
  const generatedAt = new Date().toISOString();
  const report = {
    schemaVersion: 1,
    mode: "dry-run",
    generatedAt,
    throughDate,
    statementsRoot,
    supabaseUserId: snapshot.userId,
    mappingDecisionsAppliedFromReportId: reviewManifest?.reportId ?? null,
    inventory: {
      totalPdfFiles: parsed.totalPdfFiles,
      canonicalPdfFiles: consolidated.canonicalFiles.length,
      duplicatePdfFiles: consolidated.duplicateFiles.length,
      extractedTransactions: consolidated.transactions.length,
      parsedTransactions: inRangeTransactions.length,
      excludedOutsideRequestedRange: excludedOutsideRequestedRange.length,
      folders: [...new Set(parsed.files.map((file) => file.folder))].sort().map((folder) => ({
        folder,
        files: parsed.files.filter((file) => file.folder === folder).length,
        transactions: inRangeTransactions.filter((row) =>
          row.statementFile.startsWith(`${folder}/`)
        ).length,
      })),
    },
    accountMappings: mappings,
    reconciliationWindows,
    datePolicies,
    statementCoverage: coverage,
    statementFiles: parsed.files.map((file) => ({
      statementFile: file.relativePath,
      folder: file.folder,
      parser: file.parser,
      fileHash: file.fileHash,
      pageCount: file.pageCount,
      periodStart: file.periodStart,
      periodEnd: file.periodEnd,
      statementAccountKeys: file.statementAccountKeys,
      detectedAccountLast4s: file.detectedAccountLast4s,
      transactionCount: file.transactions.length,
      totalAmount: Math.round(file.transactions.reduce((sum, row) => sum + row.amount, 0) * 100) / 100,
      warnings: file.warnings,
      validations: file.validations,
      autoInsertEligible: safeStatementFiles.has(file.relativePath),
    })),
    excludedOutsideRequestedRange: excludedOutsideRequestedRange.map((transaction) =>
      reportStatementRow(transaction, null)
    ),
    exactMatches: matches.exactMatches,
    highConfidenceMatches: matches.highConfidenceMatches,
    possibleMatches: matches.possibleMatches,
    likelyDuplicates: [
      ...matches.duplicateCandidates,
      ...consolidated.overlappingRows.filter((row) =>
        isWithinReconciliationWindow(row, windowByKey.get(row.statementAccountKey))
      ),
    ],
    conflicts: matches.conflicts,
    outsideOverlapExceptions,
    missingFromSupabase: matches.missing,
    proposedInsertions,
    automaticInsertions,
    reconciliationInsertions,
    existingNotInStatements: unmatchedExisting,
    parsingFailures,
    unmappedAccounts: mappings.filter((mapping) => mapping.status !== "mapped"),
    unmappedTransactions: matches.unmappedTransactions,
    summaries: {
      parsedByYearAndAccount: groupSummary(inRangeTransactions),
      exactMatchesByYearAndAccount: groupSummary(matches.exactMatches),
      highConfidenceMatchesByYearAndAccount: groupSummary(matches.highConfidenceMatches),
      possibleMatchesByYearAndAccount: groupSummary(matches.possibleMatches),
      conflictsByYearAndAccount: groupSummary(matches.conflicts),
      missingByYearAndAccount: groupSummary(matches.missing),
      proposedInsertionsByYearAndAccount: groupSummary(proposedInsertions),
      existingNotInStatementsByYearAndAccount: groupSummary(
        unmatchedExisting,
        "accountId"
      ),
    },
  };
  const reportIdentity = JSON.stringify({
    schemaVersion: report.schemaVersion,
    generatedAt: report.generatedAt,
    proposedExternalIds: proposedInsertions.map((row) => row.externalTransactionId),
  });
  report.reportId = stableHash(reportIdentity).slice(0, 20);
  return report;
}

export async function applyApprovedReport({ supabase, report, approval }) {
  void supabase;
  void report;
  void approval;
  throw new Error(
    "One-shot report application is disabled. Use the review manifest and staged statements:apply workflow."
  );
}
