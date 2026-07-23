import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const PROVIDER = "plaid";
const PAGE_SIZE = 1000;
const MATCH_WINDOW_DAYS = 2;

function parseEnv() {
  const envPath = path.resolve(".env.local");
  const fileEnv = fs.existsSync(envPath)
    ? Object.fromEntries(
        fs
          .readFileSync(envPath, "utf8")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .filter((line) => !line.startsWith("#"))
          .map((line) => {
            const index = line.indexOf("=");
            return [line.slice(0, index), line.slice(index + 1)];
          })
      )
    : {};

  return { ...fileEnv, ...process.env };
}

function getCliValue(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function isJsonMode() {
  return process.argv.includes("--json");
}

function requiredEnv(env, name) {
  if (!env[name]) {
    throw new Error(`Missing ${name}. Add it to .env.local or the environment.`);
  }
  return env[name];
}

function shortId(id) {
  return id ? id.slice(0, 8) : "";
}

function normalize(value) {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeInstitution(value) {
  const normalized = normalize(value);
  if (/\b(cap1|capital one|360)\b/.test(normalized)) return "capital one";
  if (/\bsofi\b/.test(normalized)) return "sofi";
  if (/\bchase|jpmorgan|jp morgan\b/.test(normalized)) return "chase";
  if (/\bgrasshopper\b/.test(normalized)) return "grasshopper";
  return normalized;
}

function tokens(value) {
  return normalize(value)
    .split(" ")
    .filter((token) => token.length >= 3 && token !== "the");
}

function tokenSimilarity(left, right) {
  const leftTokens = new Set(tokens(left));
  const rightTokens = new Set(tokens(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }
  return shared / Math.max(leftTokens.size, rightTokens.size);
}

function extractMask(account) {
  const values = [
    account.name,
    account.institution,
    account.plaid_account_id,
    account.external_account_id,
  ];

  for (const value of values) {
    const match = String(value ?? "").match(/(?:\.\.\.|x{2,}|ending\s+in\s+)?(\d{4})\b/i);
    if (match) return match[1];
  }
  return null;
}

function dateToTime(date) {
  return new Date(`${date}T00:00:00Z`).getTime();
}

function dayDiff(left, right) {
  return Math.abs(dateToTime(left) - dateToTime(right)) / 86_400_000;
}

function sameAmount(left, right) {
  return Math.abs(Number(left) - Number(right)) <= 0.005;
}

async function fetchAll(makeQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await makeQuery().range(from, to);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function resolveUserId(supabase, explicitUserId) {
  if (explicitUserId) return explicitUserId;

  const accounts = await fetchAll(() =>
    supabase.from("accounts").select("user_id").not("user_id", "is", null)
  );
  const userIds = [...new Set(accounts.map((row) => row.user_id).filter(Boolean))];
  if (userIds.length === 1) return userIds[0];
  if (userIds.length === 0) {
    throw new Error("No account user_id values found. Pass --user-id=<uuid>.");
  }

  throw new Error(
    `Multiple user_id values found. Pass --user-id=<uuid>. Candidates: ${userIds.join(", ")}`
  );
}

function isVisibleTransaction(transaction) {
  return transaction.external_status !== "removed";
}

function isTopLevel(transaction) {
  return !transaction.parent_id;
}

function summarizeTransactions(account, transactions) {
  const accountTransactions = transactions.filter((tx) => tx.account_id === account.id);
  const visible = accountTransactions.filter(isVisibleTransaction);
  const topLevel = visible.filter(isTopLevel);
  const dates = topLevel.map((tx) => tx.date).sort();
  const categorized = topLevel.filter((tx) => tx.category_id || tx.category).length;
  const plaid = topLevel.filter((tx) => tx.connection_provider === PROVIDER).length;
  const splitParents = topLevel.filter((tx) => tx.is_split).length;
  const children = visible.filter((tx) => tx.parent_id).length;

  return {
    transactionCount: topLevel.length,
    categorizedCount: categorized,
    plaidTransactionCount: plaid,
    splitParentCount: splitParents,
    childCount: children,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
  };
}

function accountSignalScore(source, target) {
  let score = 0;
  const reasons = [];

  if (source.type && target.type && source.type === target.type) {
    score += 2;
    reasons.push("same type");
  }

  const sourceMask = extractMask(source);
  const targetMask = extractMask(target);
  if (sourceMask && targetMask && sourceMask === targetMask) {
    score += 5;
    reasons.push(`same mask ${sourceMask}`);
  }

  const sourceInstitution = normalizeInstitution(source.institution);
  const targetInstitution = normalizeInstitution(target.institution);
  if (sourceInstitution && sourceInstitution === targetInstitution) {
    score += 3;
    reasons.push(`same institution ${sourceInstitution}`);
  }

  const nameSimilarity = tokenSimilarity(source.name, target.name);
  if (nameSimilarity > 0) {
    score += Math.min(4, nameSimilarity * 4);
    reasons.push(`name overlap ${Math.round(nameSimilarity * 100)}%`);
  }

  const combinedSimilarity = tokenSimilarity(
    `${source.institution} ${source.name}`,
    `${target.institution} ${target.name}`
  );
  if (combinedSimilarity > 0) {
    score += Math.min(2, combinedSimilarity * 2);
  }

  return { score, reasons };
}

function matchTransactions(sourceTransactions, targetTransactions, allTransactions) {
  const sourceTopLevel = sourceTransactions
    .filter(isVisibleTransaction)
    .filter(isTopLevel);
  const targetTopLevel = targetTransactions
    .filter(isVisibleTransaction)
    .filter(isTopLevel);
  const sourceChildrenByParent = new Map();

  for (const tx of allTransactions.filter(isVisibleTransaction)) {
    if (!tx.parent_id) continue;
    if (!sourceChildrenByParent.has(tx.parent_id)) {
      sourceChildrenByParent.set(tx.parent_id, []);
    }
    sourceChildrenByParent.get(tx.parent_id).push(tx);
  }

  const usedTargets = new Set();
  const matches = [];

  for (const source of sourceTopLevel) {
    let best = null;
    for (const target of targetTopLevel) {
      if (usedTargets.has(target.id)) continue;
      if (!sameAmount(source.amount, target.amount)) continue;

      const days = dayDiff(source.date, target.date);
      if (days > MATCH_WINDOW_DAYS) continue;

      const descriptionScore = tokenSimilarity(source.description, target.description);
      const score =
        3 +
        (days === 0 ? 2 : 1) +
        descriptionScore * 3 +
        (source.category_id || source.category ? 1 : 0);

      if (score < 4.5) continue;
      if (!best || score > best.score) {
        best = { source, target, score, days, descriptionScore };
      }
    }

    if (best) {
      usedTargets.add(best.target.id);
      matches.push({
        ...best,
        sourceHasCategory: Boolean(best.source.category_id || best.source.category),
        targetHasCategory: Boolean(best.target.category_id || best.target.category),
        sourceIsSplit: Boolean(best.source.is_split),
        sourceChildCount: sourceChildrenByParent.get(best.source.id)?.length ?? 0,
      });
    }
  }

  return matches;
}

function confidenceFor(candidate) {
  if (candidate.matchCount >= 10 || candidate.score >= 16) return "high";
  if (candidate.matchCount >= 3 || candidate.score >= 11) return "medium";
  return "low";
}

function buildCandidates(accounts, transactions) {
  const plaidAccounts = accounts.filter(
    (account) => account.connection_provider === PROVIDER
  );
  const manualAccounts = accounts.filter(
    (account) => account.connection_provider !== PROVIDER
  );
  const transactionsByAccount = new Map();

  for (const account of accounts) {
    transactionsByAccount.set(
      account.id,
      transactions.filter((tx) => tx.account_id === account.id)
    );
  }

  const candidates = [];
  for (const target of plaidAccounts) {
    for (const source of manualAccounts) {
      const signal = accountSignalScore(source, target);
      const matches = matchTransactions(
        transactionsByAccount.get(source.id) ?? [],
        transactionsByAccount.get(target.id) ?? [],
        transactions
      );
      const sourceSummary = summarizeTransactions(source, transactions);
      const targetSummary = summarizeTransactions(target, transactions);
      const matchedSourceIds = new Set(matches.map((match) => match.source.id));
      const unmatchedSource = (transactionsByAccount.get(source.id) ?? [])
        .filter(isVisibleTransaction)
        .filter(isTopLevel)
        .filter((tx) => !matchedSourceIds.has(tx.id));
      const beforeTargetRange = targetSummary.firstDate
        ? unmatchedSource.filter((tx) => tx.date < targetSummary.firstDate)
        : unmatchedSource;
      const withinTargetRange =
        targetSummary.firstDate && targetSummary.lastDate
          ? unmatchedSource.filter(
              (tx) =>
                tx.date >= targetSummary.firstDate && tx.date <= targetSummary.lastDate
            )
          : [];
      const afterTargetRange = targetSummary.lastDate
        ? unmatchedSource.filter((tx) => tx.date > targetSummary.lastDate)
        : [];
      const categoryCopyCount = matches.filter(
        (match) => match.sourceHasCategory && !match.targetHasCategory
      ).length;
      const splitCopyCount = matches.filter(
        (match) => match.sourceIsSplit || match.sourceChildCount > 0
      ).length;
      const matchCount = matches.length;
      const matchRatio =
        sourceSummary.transactionCount > 0
          ? matchCount / sourceSummary.transactionCount
          : 0;
      const overlapScore =
        matchCount >= 10 ? 10 + Math.min(5, matchRatio * 5) : matchCount;
      const score = signal.score + overlapScore;
      const candidate = {
        source,
        target,
        sourceSummary,
        targetSummary,
        score,
        confidence: "low",
        accountReasons: signal.reasons,
        matchCount,
        matchRatio,
        categoryCopyCount,
        splitCopyCount,
        unmatchedSourceCount: unmatchedSource.length,
        moveBeforeTargetRangeCount: beforeTargetRange.length,
        reviewWithinTargetRangeCount: withinTargetRange.length,
        moveAfterTargetRangeCount: afterTargetRange.length,
        matchedSourceIds: matches.map((match) => match.source.id),
      };
      candidate.confidence = confidenceFor(candidate);

      if (candidate.score >= 6 || candidate.matchCount > 0) {
        candidates.push(candidate);
      }
    }
  }

  return candidates.sort((left, right) => {
    const confidenceOrder = { high: 3, medium: 2, low: 1 };
    return (
      confidenceOrder[right.confidence] - confidenceOrder[left.confidence] ||
      right.score - left.score ||
      right.matchCount - left.matchCount
    );
  });
}

function pickBestByTarget(candidates) {
  const byTarget = new Map();
  for (const candidate of candidates) {
    const existing = byTarget.get(candidate.target.id);
    if (!existing || candidate.score > existing.score) {
      byTarget.set(candidate.target.id, candidate);
    }
  }
  return [...byTarget.values()].filter(
    (candidate) => candidate.confidence !== "low"
  );
}

function buildPlaidDuplicateGroups(accounts, summaries) {
  const groups = new Map();
  for (const account of accounts) {
    if (account.connection_provider !== PROVIDER) continue;
    const summary = summaries.get(account.id);
    const key = [
      normalizeInstitution(account.institution),
      normalize(account.name),
      account.type ?? "",
      account.current_balance ?? "",
      summary?.transactionCount ?? 0,
      summary?.firstDate ?? "",
      summary?.lastDate ?? "",
    ].join("|");

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(account);
  }

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) =>
      group
        .slice()
        .sort((left, right) => {
          const leftSummary = summaries.get(left.id);
          const rightSummary = summaries.get(right.id);
          return (
            (rightSummary?.categorizedCount ?? 0) -
              (leftSummary?.categorizedCount ?? 0) ||
            String(right.last_synced_at ?? "").localeCompare(
              String(left.last_synced_at ?? "")
            )
          );
        })
    );
}

function formatAccount(account) {
  const provider =
    account.connection_provider === PROVIDER ? "Plaid " : "Manual";
  const hidden = account.hidden ? ", hidden" : "";
  return `${provider} ${shortId(account.id)} | ${account.institution} | ${account.name} | ${account.type ?? "Unknown"}${hidden}`;
}

function printTextReport({
  accounts,
  bankConnections,
  summaries,
  candidates,
  bestCandidates,
  plaidDuplicateGroups,
}) {
  console.log("Connected banks");
  if (bankConnections.length === 0) {
    console.log("- None");
  }
  for (const connection of bankConnections) {
    console.log(
      `- ${shortId(connection.id)} | ${connection.institution_name ?? "Unknown"} | ${connection.status} | synced ${connection.last_synced_at ?? "never"}`
    );
  }

  console.log("\nDuplicate Plaid account groups");
  if (plaidDuplicateGroups.length === 0) {
    console.log("- None");
  }
  for (const group of plaidDuplicateGroups) {
    const keep = group[0];
    const keepSummary = summaries.get(keep.id);
    console.log(
      `- Keep candidate ${shortId(keep.id)} ${keep.name} (${keep.institution}); categorized ${keepSummary?.categorizedCount ?? 0}, synced ${keep.last_synced_at ?? "never"}`
    );
    for (const duplicate of group.slice(1)) {
      const duplicateSummary = summaries.get(duplicate.id);
      console.log(
        `  duplicate ${shortId(duplicate.id)} ${duplicate.name}; categorized ${duplicateSummary?.categorizedCount ?? 0}, synced ${duplicate.last_synced_at ?? "never"}`
      );
    }
  }

  console.log("\nAccounts");
  for (const account of accounts) {
    const summary = summaries.get(account.id);
    console.log(
      `- ${formatAccount(account)} | tx ${summary.transactionCount}, categorized ${summary.categorizedCount}, dates ${summary.firstDate ?? "n/a"}..${summary.lastDate ?? "n/a"}`
    );
  }

  console.log("\nLikely merge pairs");
  if (bestCandidates.length === 0) {
    console.log("- No medium/high-confidence pairs found.");
  }

  for (const candidate of bestCandidates) {
    console.log(
      `- ${candidate.confidence.toUpperCase()} ${candidate.source.name} (${candidate.source.institution}, ${shortId(candidate.source.id)}) -> ${candidate.target.name} (${candidate.target.institution}, ${shortId(candidate.target.id)})`
    );
    console.log(
      `  score ${candidate.score.toFixed(1)}; matched duplicate tx ${candidate.matchCount}; categories to copy ${candidate.categoryCopyCount}; split parents to recreate ${candidate.splitCopyCount}`
    );
    console.log(
      `  unmatched source tx ${candidate.unmatchedSourceCount}: ${candidate.moveBeforeTargetRangeCount} before target range, ${candidate.reviewWithinTargetRangeCount} inside target range, ${candidate.moveAfterTargetRangeCount} after target range`
    );
    console.log(
      `  source tx ${candidate.sourceSummary.transactionCount}, target tx ${candidate.targetSummary.transactionCount}; reasons: ${candidate.accountReasons.join(", ") || "transaction overlap"}`
    );
  }

  const low = candidates.filter((candidate) => candidate.confidence === "low");
  if (low.length > 0) {
    console.log("\nLow-confidence possibilities");
    for (const candidate of low.slice(0, 10)) {
      console.log(
        `- ${candidate.source.name} -> ${candidate.target.name}: score ${candidate.score.toFixed(1)}, matched tx ${candidate.matchCount}, reasons ${candidate.accountReasons.join(", ") || "weak transaction overlap"}`
      );
    }
  }
}

async function main() {
  const env = parseEnv();
  const supabase = createClient(
    requiredEnv(env, "NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv(env, "SUPABASE_SERVICE_ROLE_KEY")
  );
  const userId = await resolveUserId(
    supabase,
    getCliValue("user-id") || env.ACCOUNT_MERGE_USER_ID || env.CHASE_IMPORT_USER_ID
  );

  const accounts = await fetchAll(() =>
    supabase
      .from("accounts")
      .select(
        "id, name, institution, type, current_balance, last_synced_at, plaid_account_id, connection_provider, external_account_id, hidden, user_id"
      )
      .eq("user_id", userId)
      .order("institution")
      .order("name")
  );
  const bankConnections = await fetchAll(() =>
    supabase
      .from("bank_connections")
      .select(
        "id, institution_name, institution_id, provider, status, last_synced_at, user_id"
      )
      .eq("user_id", userId)
      .eq("provider", PROVIDER)
      .order("institution_name")
  );
  const transactions = await fetchAll(() =>
    supabase
      .from("transactions")
      .select(
        "id, date, description, amount, category_id, category, account_id, status, connection_provider, external_transaction_id, external_status, source, upload_source, is_split, parent_id, user_id, created_at, not_duplicate"
      )
      .eq("user_id", userId)
      .order("date")
  );

  const summaries = new Map(
    accounts.map((account) => [
      account.id,
      summarizeTransactions(account, transactions),
    ])
  );
  const candidates = buildCandidates(accounts, transactions);
  const bestCandidates = pickBestByTarget(candidates);
  const plaidDuplicateGroups = buildPlaidDuplicateGroups(accounts, summaries);

  if (isJsonMode()) {
    console.log(
      JSON.stringify(
        {
          userId,
          accounts: accounts.map((account) => ({
            ...account,
            summary: summaries.get(account.id),
          })),
          bankConnections,
          plaidDuplicateGroups: plaidDuplicateGroups.map((group) =>
            group.map((account) => ({
              id: account.id,
              name: account.name,
              institution: account.institution,
              type: account.type,
              current_balance: account.current_balance,
              last_synced_at: account.last_synced_at,
              external_account_id: account.external_account_id,
              summary: summaries.get(account.id),
            }))
          ),
          candidates: candidates.map((candidate) => ({
            confidence: candidate.confidence,
            score: candidate.score,
            sourceAccountId: candidate.source.id,
            sourceName: candidate.source.name,
            sourceInstitution: candidate.source.institution,
            targetAccountId: candidate.target.id,
            targetName: candidate.target.name,
            targetInstitution: candidate.target.institution,
            matchCount: candidate.matchCount,
            matchRatio: candidate.matchRatio,
            categoryCopyCount: candidate.categoryCopyCount,
            splitCopyCount: candidate.splitCopyCount,
            unmatchedSourceCount: candidate.unmatchedSourceCount,
            moveBeforeTargetRangeCount: candidate.moveBeforeTargetRangeCount,
            reviewWithinTargetRangeCount: candidate.reviewWithinTargetRangeCount,
            moveAfterTargetRangeCount: candidate.moveAfterTargetRangeCount,
            accountReasons: candidate.accountReasons,
            sourceSummary: candidate.sourceSummary,
            targetSummary: candidate.targetSummary,
          })),
          bestCandidates: bestCandidates.map((candidate) => ({
            confidence: candidate.confidence,
            score: candidate.score,
            sourceAccountId: candidate.source.id,
            sourceName: candidate.source.name,
            sourceInstitution: candidate.source.institution,
            targetAccountId: candidate.target.id,
            targetName: candidate.target.name,
            targetInstitution: candidate.target.institution,
            matchCount: candidate.matchCount,
            categoryCopyCount: candidate.categoryCopyCount,
            splitCopyCount: candidate.splitCopyCount,
            unmatchedSourceCount: candidate.unmatchedSourceCount,
            moveBeforeTargetRangeCount: candidate.moveBeforeTargetRangeCount,
            reviewWithinTargetRangeCount: candidate.reviewWithinTargetRangeCount,
            moveAfterTargetRangeCount: candidate.moveAfterTargetRangeCount,
          })),
        },
        null,
        2
      )
    );
    return;
  }

  printTextReport({
    accounts,
    bankConnections,
    summaries,
    candidates,
    bestCandidates,
    plaidDuplicateGroups,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
