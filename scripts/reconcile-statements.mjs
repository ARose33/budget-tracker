import fs from "node:fs/promises";
import path from "node:path";
import {
  buildReconciliationReport,
  createSupabase,
  loadEnvironment,
  loadSupabaseSnapshot,
  parseAllStatements,
} from "./lib/statement-reconciler.mjs";
import {
  applyApprovedBatch,
  buildReviewManifest,
  rollbackBatchReceipt,
  validateReviewManifest,
  verifyBatchReceipt,
} from "./lib/statement-review.mjs";

const repoRoot = process.cwd();
const defaultStatementsRoot = path.join(repoRoot, "Statements", "Budget Input");
const defaultOutputRoot = path.join(repoRoot, "reports", "statement-reconciliation");

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function csvValue(value) {
  if (value == null) return "";
  const text =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function flattenRow(row) {
  const flattened = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "insertRecord" && value) {
      for (const [insertKey, insertValue] of Object.entries(value)) {
        flattened[`insert_${insertKey}`] = insertValue;
      }
    } else {
      flattened[key] = value;
    }
  }
  return flattened;
}

async function writeCsv(filePath, rows) {
  const flattened = rows.map(flattenRow);
  const headers = [...new Set(flattened.flatMap((row) => Object.keys(row)))];
  const content = [
    headers.map(csvValue).join(","),
    ...flattened.map((row) => headers.map((header) => csvValue(row[header])).join(",")),
  ].join("\n");
  await fs.writeFile(filePath, `${content}\n`, "utf8");
}

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function total(rows) {
  return Math.round(rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0) * 100) / 100;
}

function summaryTable(rows) {
  if (rows.length === 0) return "_None_";
  return [
    "| Year | Statement account | Count | Net amount |",
    "|---:|---|---:|---:|",
    ...rows.map(
      (row) => `| ${row.year} | ${row.account} | ${row.count} | ${money(row.totalAmount)} |`
    ),
  ].join("\n");
}

function reviewBatchPlan(report, manifest) {
  const rowById = new Map(
    report.proposedInsertions.map((row) => [row.sourceRecordId, row])
  );
  const groups = new Map();
  for (const decision of manifest.insertionDecisions) {
    const row = rowById.get(decision.sourceRecordId);
    if (!row) continue;
    const month = row.appliedDate.slice(0, 7);
    const key = `${row.statementAccountKey}|${month}`;
    const entry = groups.get(key) ?? {
      statementAccountKey: row.statementAccountKey,
      month,
      eligible: 0,
      approved: 0,
      pending: 0,
      approvedAmount: 0,
      pendingAmount: 0,
    };
    entry.eligible += 1;
    if (decision.decision === "approved") {
      entry.approved += 1;
      entry.approvedAmount = Math.round((entry.approvedAmount + Number(row.amount)) * 100) / 100;
    } else {
      entry.pending += 1;
      entry.pendingAmount = Math.round((entry.pendingAmount + Number(row.amount)) * 100) / 100;
    }
    groups.set(key, entry);
  }
  return [...groups.values()].sort(
    (left, right) =>
      left.statementAccountKey.localeCompare(right.statementAccountKey) ||
      left.month.localeCompare(right.month)
  );
}

function reviewSummary(report, manifest, validation, batchPlan) {
  const pendingAccounts = manifest.accountDecisions.filter(
    (decision) => decision.decision !== "approved"
  );
  const riskCounts = new Map();
  for (const decision of manifest.insertionDecisions) {
    for (const flag of decision.riskFlags) {
      riskCounts.set(flag, (riskCounts.get(flag) ?? 0) + 1);
    }
  }
  return `${[
    "# Statement import review manifest",
    "",
    `Report: \`${report.reportId}\``,
    `Current manifest approval token: \`${validation.expectedToken}\``,
    "",
    "## Apply eligibility",
    "",
    `- Proposed rows: ${validation.totals.eligible}`,
    `- Approved low-risk rows: ${validation.totals.approved} (${money(validation.totals.approvedAmount)})`,
    `- Pending transaction reviews: ${validation.totals.excluded}`,
    `- Pending account decisions: ${pendingAccounts.length}`,
    "",
    "## Pending accounts",
    "",
    ...(pendingAccounts.length
      ? pendingAccounts.map(
          (decision) =>
            `- ${decision.statementAccountKey}: recommended ${decision.recommendedAccountId}; aliases ${decision.aliasAccountIds.join(", ") || "none"}.`
        )
      : ["_None_"]),
    "",
    "## Risk flags",
    "",
    ...[...riskCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([flag, count]) => `- ${flag}: ${count}`),
    "",
    "## Staged commands",
    "",
    "1. Edit `review-manifest.json`; change only decisions that have been reviewed.",
    "2. Recalculate the token and inspect a batch:",
    "",
    "   `npm run statements:review -- --report=reports/statement-reconciliation/latest/reconciliation.json --manifest=reports/statement-reconciliation/latest/review-manifest.json --account=<statement-account-key> --month=YYYY-MM`",
    "",
    "3. Apply that account/month using the token printed by the review command:",
    "",
    "   `npm run statements:apply -- --report=reports/statement-reconciliation/latest/reconciliation.json --manifest=reports/statement-reconciliation/latest/review-manifest.json --account=<statement-account-key> --month=YYYY-MM --approval=<token>`",
    "",
    "4. Verify the emitted receipt with `npm run statements:verify` and rerun the dry run before the next batch.",
    "",
    `The detailed batch plan contains ${batchPlan.length} account-month rows.`,
  ].join("\n")}\n`;
}

function markdownReport(report) {
  const mapped = report.accountMappings.filter((mapping) => mapping.status === "mapped");
  const review = report.accountMappings.filter((mapping) => mapping.status !== "mapped");
  const sections = [
    "# Statement reconciliation dry run",
    "",
    `Generated: ${report.generatedAt}`,
    `Report approval ID: \`${report.reportId}\``,
    "",
    "No Supabase rows were written by this dry run.",
    "",
    "## Totals",
    "",
    `- PDF files found: ${report.inventory.totalPdfFiles}`,
    `- Canonical PDF files: ${report.inventory.canonicalPdfFiles}`,
    `- Duplicate PDF files: ${report.inventory.duplicatePdfFiles}`,
    `- Statement transactions parsed: ${report.inventory.parsedTransactions} (${money(
      total(report.missingFromSupabase.concat(report.exactMatches, report.highConfidenceMatches, report.possibleMatches, report.conflicts, report.unmappedTransactions))
    )} net across classified statement rows)`,
    `- Parsed rows excluded outside 2023-01-01 through ${report.throughDate}: ${report.inventory.excludedOutsideRequestedRange}`,
    `- Exact matches: ${report.exactMatches.length}`,
    `- High-confidence matches: ${report.highConfidenceMatches.length}`,
    `- Possible matches requiring review: ${report.possibleMatches.length}`,
    `- Missing from Supabase: ${report.missingFromSupabase.length}`,
    `- Proposed high-confidence insertions: ${report.proposedInsertions.length} (${money(
      total(report.proposedInsertions)
    )})`,
    `- Likely duplicates: ${report.likelyDuplicates.length}`,
    `- Conflicts: ${report.conflicts.length}`,
    `- Existing Supabase rows not found in covered statement months: ${report.existingNotInStatements.length}`,
    `- Parsing warnings/failures: ${report.parsingFailures.length}`,
    `- Unmapped/uncertain statement accounts: ${report.unmappedAccounts.length}`,
    "",
    "## Statement folders",
    "",
    "| Folder | Files | Parsed transactions |",
    "|---|---:|---:|",
    ...report.inventory.folders.map(
      (folder) => `| ${folder.folder} | ${folder.files} | ${folder.transactions} |`
    ),
    "",
    "## Account mappings",
    "",
    ...mapped.map((mapping) => {
      const account = mapping.candidates.find((candidate) => candidate.id === mapping.accountId);
      return `- ${mapping.statementAccountKey} -> ${account?.institution} ${account?.name} (${mapping.accountId}). ${mapping.rationale}`;
    }),
    ...(review.length > 0
      ? [
          "",
          "### Requires review",
          "",
          ...review.map(
            (mapping) =>
              `- ${mapping.statementAccountKey}: ${mapping.rationale} Candidates: ${mapping.candidates
                .map((candidate) => `${candidate.name} (${candidate.id})`)
                .join(", ") || "none"}.`
          ),
        ]
      : []),
    "",
    "## Missing / proposed by year and account",
    "",
    summaryTable(report.summaries.proposedInsertionsByYearAndAccount),
    "",
    "## Exact matches by year and account",
    "",
    summaryTable(report.summaries.exactMatchesByYearAndAccount),
    "",
    "## High-confidence matches by year and account",
    "",
    summaryTable(report.summaries.highConfidenceMatchesByYearAndAccount),
    "",
    "## Coverage gaps",
    "",
    ...report.statementCoverage.map(
      (coverage) =>
        `- ${coverage.statementAccountKey}: ${coverage.statementFiles} files, ${coverage.firstPeriodStart ?? "unknown"} through ${coverage.lastPeriodEnd ?? "unknown"}; ${coverage.missingMonths.length} uncovered month(s): ${coverage.missingMonths.join(", ") || "none"}.`
    ),
    "",
    "## Review files",
    "",
    "The adjacent CSV exports contain the exact rows for insertions, matches, possible matches, duplicates, conflicts, existing-only rows, parser failures, mappings, and coverage.",
    "",
    "## Staged review and apply",
    "",
    "Generate the durable account/date/transaction decision manifest:",
    "",
    `\`npm run statements:prepare -- --report=${path
      .join("reports", "statement-reconciliation", "latest", "reconciliation.json")
      .replaceAll("\\", "/")}\``,
    "",
    "After reviewing and editing the manifest, validate it to receive its current approval token. Apply only one account/month batch at a time. The apply command performs a server-side rollback validation, uses deterministic external IDs, verifies every stored field after the write, and emits a batch-specific receipt. It never updates or deletes an existing transaction.",
  ];
  return `${sections.join("\n")}\n`;
}

async function exportReport(report, outputDirectory) {
  await fs.mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    fs.writeFile(
      path.join(outputDirectory, "reconciliation.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8"
    ),
    fs.writeFile(path.join(outputDirectory, "summary.md"), markdownReport(report), "utf8"),
    writeCsv(path.join(outputDirectory, "proposed-insertions.csv"), report.proposedInsertions),
    writeCsv(path.join(outputDirectory, "exact-matches.csv"), report.exactMatches),
    writeCsv(
      path.join(outputDirectory, "high-confidence-matches.csv"),
      report.highConfidenceMatches
    ),
    writeCsv(path.join(outputDirectory, "possible-matches.csv"), report.possibleMatches),
    writeCsv(path.join(outputDirectory, "likely-duplicates.csv"), report.likelyDuplicates),
    writeCsv(path.join(outputDirectory, "conflicts.csv"), report.conflicts),
    writeCsv(
      path.join(outputDirectory, "existing-not-in-statements.csv"),
      report.existingNotInStatements
    ),
    writeCsv(path.join(outputDirectory, "parsing-failures.csv"), report.parsingFailures),
    writeCsv(path.join(outputDirectory, "unmapped-accounts.csv"), report.unmappedAccounts),
    writeCsv(path.join(outputDirectory, "unmapped-transactions.csv"), report.unmappedTransactions),
    writeCsv(path.join(outputDirectory, "statement-coverage.csv"), report.statementCoverage),
    writeCsv(path.join(outputDirectory, "statement-files.csv"), report.statementFiles),
  ]);
}

async function dryRun() {
  const env = await loadEnvironment(repoRoot);
  const supabase = createSupabase(env);
  const statementsRoot = path.resolve(argument("statements") ?? defaultStatementsRoot);
  const outputDirectory = path.resolve(argument("output") ?? path.join(defaultOutputRoot, "latest"));
  const throughDate = argument("through") ?? new Date().toISOString().slice(0, 10);
  const manifestPath = argument("manifest");
  const reviewManifest = manifestPath
    ? JSON.parse(await fs.readFile(path.resolve(manifestPath), "utf8"))
    : null;
  const parsed = await parseAllStatements(statementsRoot, ({ index, total: count, filePath }) => {
    console.log(`[${index}/${count}] ${path.relative(statementsRoot, filePath)}`);
  });
  console.log("Loading Supabase accounts and transactions (read-only)...");
  const snapshot = await loadSupabaseSnapshot(supabase, env.STATEMENT_IMPORT_USER_ID);
  const report = await buildReconciliationReport({
    statementsRoot,
    snapshot,
    parsed,
    throughDate,
    reviewManifest,
  });
  await exportReport(report, outputDirectory);
  console.log(
    JSON.stringify(
      {
        mode: "dry-run",
        reportId: report.reportId,
        outputDirectory,
        pdfFiles: report.inventory.totalPdfFiles,
        parsedTransactions: report.inventory.parsedTransactions,
        exactMatches: report.exactMatches.length,
        highConfidenceMatches: report.highConfidenceMatches.length,
        possibleMatches: report.possibleMatches.length,
        proposedInsertions: report.proposedInsertions.length,
        likelyDuplicates: report.likelyDuplicates.length,
        conflicts: report.conflicts.length,
        parsingFailures: report.parsingFailures.length,
        unmappedAccounts: report.unmappedAccounts.length,
      },
      null,
      2
    )
  );
}

async function applyReport() {
  const reportPath = argument("report");
  if (!reportPath) throw new Error("--report=<path-to-reconciliation.json> is required.");
  const manifestPath = argument("manifest");
  if (!manifestPath) throw new Error("--manifest=<path-to-review-manifest.json> is required.");
  const approval = argument("approval");
  const report = JSON.parse(await fs.readFile(path.resolve(reportPath), "utf8"));
  const manifest = JSON.parse(await fs.readFile(path.resolve(manifestPath), "utf8"));
  const env = await loadEnvironment(repoRoot);
  const supabase = createSupabase(env);
  const filters = {
    account: argument("account"),
    year: argument("year"),
    month: argument("month"),
  };
  const result = await applyApprovedBatch({
    supabase,
    report,
    manifest,
    approval,
    filters,
  });
  const receiptPath = path.join(
    path.dirname(path.resolve(reportPath)),
    `apply-receipt-${result.batchId}.json`
  );
  await fs.writeFile(
    receiptPath,
    `${JSON.stringify({ ...result, appliedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8"
  );
  console.log(JSON.stringify({ ...result, receiptPath }, null, 2));
}

async function prepareReview() {
  const reportPath = argument("report");
  if (!reportPath) throw new Error("--report=<path-to-reconciliation.json> is required.");
  const report = JSON.parse(await fs.readFile(path.resolve(reportPath), "utf8"));
  const env = await loadEnvironment(repoRoot);
  const snapshot = await loadSupabaseSnapshot(
    createSupabase(env),
    env.STATEMENT_IMPORT_USER_ID
  );
  const manifest = buildReviewManifest(report, snapshot);
  const outputDirectory = path.resolve(argument("output") ?? path.dirname(path.resolve(reportPath)));
  await fs.mkdir(outputDirectory, { recursive: true });
  const manifestPath = path.join(outputDirectory, "review-manifest.json");
  await Promise.all([
    fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    writeCsv(path.join(outputDirectory, "insertion-decisions.csv"), manifest.insertionDecisions),
    writeCsv(path.join(outputDirectory, "account-decisions.csv"), manifest.accountDecisions),
    writeCsv(path.join(outputDirectory, "date-decisions.csv"), manifest.dateDecisions),
  ]);
  const validation = validateReviewManifest(report, manifest);
  const batchPlan = reviewBatchPlan(report, manifest);
  await Promise.all([
    writeCsv(path.join(outputDirectory, "batch-plan.csv"), batchPlan),
    fs.writeFile(
      path.join(outputDirectory, "review-summary.md"),
      reviewSummary(report, manifest, validation, batchPlan),
      "utf8"
    ),
  ]);
  console.log(
    JSON.stringify(
      {
        mode: "prepare-review",
        manifestPath,
        approvalToken: validation.expectedToken,
        totals: validation.totals,
        pendingAccounts: manifest.accountDecisions.filter(
          (decision) => decision.decision !== "approved"
        ).map((decision) => decision.statementAccountKey),
        pendingInsertionReviews: manifest.insertionDecisions.filter(
          (decision) => decision.decision !== "approved"
        ).length,
      },
      null,
      2
    )
  );
}

async function reviewManifest() {
  const reportPath = argument("report");
  const manifestPath = argument("manifest");
  if (!reportPath || !manifestPath) {
    throw new Error("--report and --manifest are required.");
  }
  const report = JSON.parse(await fs.readFile(path.resolve(reportPath), "utf8"));
  const manifest = JSON.parse(await fs.readFile(path.resolve(manifestPath), "utf8"));
  const validation = validateReviewManifest(report, manifest, {
    account: argument("account"),
    year: argument("year"),
    month: argument("month"),
  });
  console.log(
    JSON.stringify(
      {
        mode: "review",
        approvalToken: validation.expectedToken,
        manifestTokenIsCurrent: manifest.approvalToken === validation.expectedToken,
        totals: validation.totals,
        excludedReasons: validation.excluded.reduce((result, row) => {
          for (const reason of row.reasons) result[reason] = (result[reason] ?? 0) + 1;
          return result;
        }, {}),
      },
      null,
      2
    )
  );
}

async function verifyReceipt() {
  const reportPath = argument("report");
  const receiptPath = argument("receipt");
  if (!receiptPath) throw new Error("--receipt is required.");
  const report = reportPath
    ? JSON.parse(await fs.readFile(path.resolve(reportPath), "utf8"))
    : null;
  const receipt = JSON.parse(await fs.readFile(path.resolve(receiptPath), "utf8"));
  const env = await loadEnvironment(repoRoot);
  const result = await verifyBatchReceipt({
    supabase: createSupabase(env),
    report,
    receipt,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function rollbackReceipt() {
  const receiptPath = argument("receipt");
  if (!receiptPath) throw new Error("--receipt is required.");
  const receipt = JSON.parse(await fs.readFile(path.resolve(receiptPath), "utf8"));
  const env = await loadEnvironment(repoRoot);
  const result = await rollbackBatchReceipt({
    supabase: createSupabase(env),
    receipt,
    approval: argument("approval"),
  });
  console.log(JSON.stringify(result, null, 2));
}

async function exportExistingReport() {
  const reportPath = argument("report");
  if (!reportPath) throw new Error("--report=<path-to-reconciliation.json> is required.");
  const report = JSON.parse(await fs.readFile(path.resolve(reportPath), "utf8"));
  const outputDirectory = path.resolve(argument("output") ?? path.dirname(path.resolve(reportPath)));
  await exportReport(report, outputDirectory);
  console.log(JSON.stringify({ mode: "export", reportId: report.reportId, outputDirectory }, null, 2));
}

const command = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "dry-run";
if (command === "dry-run") await dryRun();
else if (command === "apply") await applyReport();
else if (command === "export") await exportExistingReport();
else if (command === "prepare") await prepareReview();
else if (command === "review") await reviewManifest();
else if (command === "verify") await verifyReceipt();
else if (command === "rollback") await rollbackReceipt();
else throw new Error(`Unknown command: ${command}`);
