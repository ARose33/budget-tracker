import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (!match) return [];
    return [[match[1].trim(), match[2].trim().replace(/^(['"])(.*)\1$/, "$2")]];
  }));
}

const repoRoot = process.cwd();
const reportDir = path.join(repoRoot, "reports", "statement-reconciliation", "latest");
const [envText, reportText, manifestText] = await Promise.all([
  fs.readFile(path.join(repoRoot, ".env.local"), "utf8"),
  fs.readFile(path.join(reportDir, "reconciliation.json"), "utf8"),
  fs.readFile(path.join(reportDir, "review-manifest.json"), "utf8"),
]);
const env = { ...parseEnv(envText), ...process.env };
const report = JSON.parse(reportText);
const manifest = JSON.parse(manifestText);
if (report.reportId !== manifest.reportId) throw new Error("Report and review manifest do not match.");

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: accounts, error: accountError } = await supabase
  .from("accounts").select("id,name").eq("user_id", report.supabaseUserId);
if (accountError) throw accountError;
const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
const decisions = new Map(manifest.insertionDecisions.map((item) => [item.sourceRecordId, item]));

function toReview(item, reviewType) {
  const candidateIds = item.candidateSupabaseTransactionIds ??
    (item.matchedSupabaseTransactionId ? [item.matchedSupabaseTransactionId] : []);
  const proposed = report.proposedInsertions.find((row) => row.sourceRecordId === item.sourceRecordId);
  const insertRecord = proposed?.insertRecord ?? {
    date: item.transactionDate,
    description: item.description,
    amount: item.amount,
    account_id: item.mappedAccountId,
    account: accountNames.get(item.mappedAccountId) ?? item.statementAccountKey,
    source: "statement",
    upload_source: `statement:${item.statementFile}`,
    connection_provider: "statement",
    external_transaction_id: `stmt_review_${item.sourceRecordId.slice(0, 48)}`,
    external_status: "posted",
  };
  return {
    user_id: report.supabaseUserId,
    report_id: report.reportId,
    source_record_id: item.sourceRecordId,
    review_type: reviewType,
    status: "pending",
    statement_account_key: item.statementAccountKey,
    account_id: item.mappedAccountId,
    account_name: accountNames.get(item.mappedAccountId) ?? insertRecord.account ?? null,
    transaction_date: item.transactionDate,
    posted_date: item.postedDate,
    proposed_date: proposed?.appliedDate ?? item.transactionDate,
    amount: item.amount,
    description: item.description,
    statement_file: item.statementFile,
    statement_period_start: item.statementPeriodStart,
    statement_period_end: item.statementPeriodEnd,
    page: item.page,
    row_reference: item.rowReference,
    candidate_transaction_ids: candidateIds,
    candidates: item.candidates ?? [],
    reason: item.reason ?? (reviewType === "proposed_import" ? "Not matched to an existing Supabase transaction." : null),
    proposed_transaction: insertRecord,
    risk_flags: decisions.get(item.sourceRecordId)?.riskFlags ?? [],
  };
}

const rows = [
  ...report.proposedInsertions.map((item) => toReview(item, "proposed_import")),
  ...report.possibleMatches.map((item) => toReview(item, "possible_match")),
  ...report.conflicts.map((item) => toReview(item, "conflict")),
  ...report.likelyDuplicates.map((item) => toReview(item, "likely_duplicate")),
];

for (let offset = 0; offset < rows.length; offset += 200) {
  const { error } = await supabase.from("statement_reconciliation_reviews").upsert(
    rows.slice(offset, offset + 200),
    { onConflict: "user_id,report_id,source_record_id,review_type", ignoreDuplicates: true }
  );
  if (error) throw error;
}

const { count, error: countError } = await supabase
  .from("statement_reconciliation_reviews")
  .select("id", { count: "exact", head: true })
  .eq("user_id", report.supabaseUserId).eq("report_id", report.reportId).eq("status", "pending");
if (countError) throw countError;
console.log(`Seeded ${rows.length} review records; ${count} are pending for report ${report.reportId}.`);
