import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const PROVIDER = "plaid";
const PAGE_SIZE = 1000;
const MATCH_WINDOW_DAYS = 2;
const REMOVED = "removed";

const MANUAL_ACCOUNT_MERGES = [
  {
    label: "SoFi Savings -> SoFi Savings (...8139)",
    source: "3e912173",
    target: "542ecff0",
  },
  {
    label: "SoFi Checking -> SoFi Checking (...2294)",
    source: "374dcc02",
    target: "0c407433",
  },
  {
    label: "AirBnB Checking -> INNOVATOR BUSINESS CHECKING (...6265)",
    source: "864384f9",
    target: "be3c5507",
  },
  {
    label: "Chase Savings -> CHASE SAVINGS (...0326)",
    source: "aad02ae6",
    target: "8de93f93",
  },
  {
    label: "Reserve -> CREDIT CARD (...5420)",
    source: "84ac01fd",
    target: "cc2e97e2",
  },
  {
    label: "Chase Sapphire Reserve (...3568) -> CREDIT CARD (...5420)",
    source: "60f68353",
    target: "cc2e97e2",
  },
  {
    label: "Freedom -> CREDIT CARD (...6158)",
    source: "5af87c5c",
    target: "abbd8003",
  },
  {
    label: "Chase Checking -> TOTAL CHECKING (...4522)",
    source: "73877d57",
    target: "8899163e",
  },
  {
    label: "Cap1 Savings -> 360 Performance Savings (...0580)",
    source: "4afaeca4",
    target: "ba83d815",
  },
  {
    label: "Cap1 Checking -> Cap1 Check (...3244)",
    source: "807d3d4d",
    target: "8747d5e7",
  },
  {
    label: "Venture/QS -> Quicksilver (...9401)",
    source: "23a529b4",
    target: "ec33fdd4",
  },
  {
    label: "Amazon CC -> Prime Store Card (...2846)",
    source: "4875f2b3",
    target: "635883be",
  },
];

const DUPLICATE_PLAID_ACCOUNT_MERGES = [
  {
    label: "Duplicate Chase Savings -> kept Chase Savings",
    source: "0fb5584a",
    target: "8de93f93",
  },
  {
    label: "Duplicate Chase CREDIT CARD (...5420) -> kept CREDIT CARD (...5420)",
    source: "2628ca8d",
    target: "cc2e97e2",
  },
  {
    label: "Duplicate Chase CREDIT CARD (...6158) -> kept CREDIT CARD (...6158)",
    source: "c1685e57",
    target: "abbd8003",
  },
  {
    label: "Duplicate Chase TOTAL CHECKING -> kept TOTAL CHECKING",
    source: "76eceb4c",
    target: "8899163e",
  },
];

const CONNECTIONS_TO_RETIRE = [
  {
    label: "Retire duplicate Chase Plaid connection",
    id: "973a0ad2",
  },
];

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

function isCommitMode() {
  return process.argv.includes("--commit");
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
    .replace(/\b(pos|debit|card|purchase|payment|online|checkcard)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value) {
  return new Set(
    normalize(value)
      .split(" ")
      .filter((token) => token.length >= 3)
  );
}

function tokenSimilarity(left, right) {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }
  return shared / Math.max(leftTokens.size, rightTokens.size);
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

function isVisible(transaction) {
  return transaction.external_status !== REMOVED;
}

function isTopLevel(transaction) {
  return !transaction.parent_id;
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
  throw new Error(`Pass --user-id=<uuid>. Found ${userIds.length} user ids.`);
}

function resolveByPrefix(rows, prefix, label) {
  const matches = rows.filter((row) => row.id.startsWith(prefix));
  if (matches.length !== 1) {
    throw new Error(
      `${label}: expected one row for id prefix ${prefix}, found ${matches.length}`
    );
  }
  return matches[0];
}

function statusRank(status) {
  if (status === "Confirmed") return 3;
  if (status === "Pending") return 2;
  if (status === "Unconfirmed") return 1;
  return 0;
}

function candidateScore(source, target) {
  const days = dayDiff(source.date, target.date);
  const descriptionScore = tokenSimilarity(source.description, target.description);
  return {
    days,
    descriptionScore,
    score:
      3 +
      (days === 0 ? 2 : 1) +
      descriptionScore * 3 +
      (source.category_id || source.category ? 1 : 0),
  };
}

function assignCandidates(candidates, usedSources, usedTargets) {
  const matches = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    if (usedSources.has(candidate.source.id) || usedTargets.has(candidate.target.id)) {
      continue;
    }
    usedSources.add(candidate.source.id);
    usedTargets.add(candidate.target.id);
    matches.push(candidate);
  }
  return matches;
}

function matchTransactions(sourceTransactions, targetTransactions) {
  const sourceTopLevel = sourceTransactions.filter(isVisible).filter(isTopLevel);
  const targetTopLevel = targetTransactions.filter(isVisible).filter(isTopLevel);
  const strictCandidates = [];

  for (const source of sourceTopLevel) {
    for (const target of targetTopLevel) {
      if (!sameAmount(source.amount, target.amount)) continue;
      const candidate = candidateScore(source, target);
      if (candidate.days > MATCH_WINDOW_DAYS) continue;
      if (candidate.score < 4.5) continue;
      strictCandidates.push({ ...candidate, source, target, matchType: "strict" });
    }
  }

  const usedSources = new Set();
  const usedTargets = new Set();
  const matches = assignCandidates(strictCandidates, usedSources, usedTargets);
  const looseCandidates = [];
  const targetCandidateCounts = new Map();

  for (const source of sourceTopLevel) {
    if (usedSources.has(source.id)) continue;
    const candidates = targetTopLevel.filter((target) => {
      if (usedTargets.has(target.id)) return false;
      return sameAmount(source.amount, target.amount) &&
        dayDiff(source.date, target.date) <= MATCH_WINDOW_DAYS;
    });

    if (candidates.length !== 1) continue;
    const target = candidates[0];
    targetCandidateCounts.set(
      target.id,
      (targetCandidateCounts.get(target.id) ?? 0) + 1
    );
    looseCandidates.push({
      ...candidateScore(source, target),
      source,
      target,
      matchType: "unique amount/date",
    });
  }

  matches.push(
    ...assignCandidates(
      looseCandidates.filter(
        (candidate) => targetCandidateCounts.get(candidate.target.id) === 1
      ),
      usedSources,
      usedTargets
    )
  );

  return matches;
}

function buildChildrenByParent(transactions) {
  const childrenByParent = new Map();
  for (const transaction of transactions.filter(isVisible)) {
    if (!transaction.parent_id) continue;
    if (!childrenByParent.has(transaction.parent_id)) {
      childrenByParent.set(transaction.parent_id, []);
    }
    childrenByParent.get(transaction.parent_id).push(transaction);
  }
  return childrenByParent;
}

function buildTargetUpdate(source, target) {
  const update = {};
  const conflicts = [];

  if (source.category_id) {
    if (!target.category_id) {
      update.category_id = source.category_id;
    } else if (source.category_id !== target.category_id) {
      conflicts.push({
        targetId: target.id,
        sourceCategoryId: source.category_id,
        targetCategoryId: target.category_id,
      });
    }
  }

  if (source.category && !target.category) {
    update.category = source.category;
  }

  if (statusRank(source.status) > statusRank(target.status)) {
    update.status = source.status;
  }

  if (source.not_duplicate && !target.not_duplicate) {
    update.not_duplicate = true;
  }

  return { update, conflicts };
}

function buildChildInsert(sourceChild, targetParent, targetAccount) {
  const rest = { ...sourceChild };
  delete rest.id;
  delete rest.created_at;
  delete rest.external_transaction_id;
  delete rest.plaid_transaction_id;

  return {
    ...rest,
    account_id: targetAccount.id,
    account: targetAccount.name,
    parent_id: targetParent.id,
    connection_provider: "manual",
    external_transaction_id: null,
    plaid_transaction_id: null,
    external_status: null,
  };
}

function applyLocalUpdate(transaction, update) {
  Object.assign(transaction, update);
}

async function maybeUpdateTransaction(supabase, userId, transaction, update, commit) {
  if (Object.keys(update).length === 0) return;
  applyLocalUpdate(transaction, update);
  if (!commit) return;

  const { error } = await supabase
    .from("transactions")
    .update(update)
    .eq("id", transaction.id)
    .eq("user_id", userId);
  if (error) throw error;
}

async function maybeInsertRows(supabase, rows, commit) {
  if (rows.length === 0 || !commit) return;
  const { error } = await supabase.from("transactions").insert(rows);
  if (error) throw error;
}

async function maybeHideAccount(supabase, userId, account, commit) {
  account.hidden = true;
  if (!commit) return;

  const { error } = await supabase
    .from("accounts")
    .update({ hidden: true })
    .eq("id", account.id)
    .eq("user_id", userId);
  if (error) throw error;
}

async function mergeManualAccount({
  supabase,
  userId,
  sourceAccount,
  targetAccount,
  transactions,
  commit,
}) {
  const summary = {
    label: `${sourceAccount.name} -> ${targetAccount.name}`,
    matched: 0,
    strictMatches: 0,
    looseMatches: 0,
    targetUpdates: 0,
    categoryConflicts: 0,
    sourceRemoved: 0,
    movedParents: 0,
    movedChildren: 0,
    splitChildrenInserted: 0,
  };
  const childrenByParent = buildChildrenByParent(transactions);
  const sourceTransactions = transactions.filter(
    (transaction) => transaction.account_id === sourceAccount.id
  );
  const targetTransactions = transactions.filter(
    (transaction) => transaction.account_id === targetAccount.id
  );
  const matches = matchTransactions(sourceTransactions, targetTransactions);
  const matchedSourceIds = new Set(matches.map((match) => match.source.id));

  for (const match of matches) {
    const { update, conflicts } = buildTargetUpdate(match.source, match.target);
    summary.categoryConflicts += conflicts.length;
    if (Object.keys(update).length > 0) {
      summary.targetUpdates += 1;
      await maybeUpdateTransaction(
        supabase,
        userId,
        match.target,
        update,
        commit
      );
    }

    const sourceChildren = childrenByParent.get(match.source.id) ?? [];
    const targetChildren = childrenByParent.get(match.target.id) ?? [];
    if (sourceChildren.length > 0 && targetChildren.length === 0) {
      const childRows = sourceChildren.map((child) =>
        buildChildInsert(child, match.target, targetAccount)
      );
      summary.splitChildrenInserted += childRows.length;
      await maybeUpdateTransaction(
        supabase,
        userId,
        match.target,
        { is_split: true },
        commit
      );
      await maybeInsertRows(supabase, childRows, commit);
    }

    const duplicateRows = [match.source, ...sourceChildren];
    for (const duplicate of duplicateRows) {
      if (duplicate.external_status === REMOVED) continue;
      summary.sourceRemoved += 1;
      await maybeUpdateTransaction(
        supabase,
        userId,
        duplicate,
        { external_status: REMOVED },
        commit
      );
    }

    summary.matched += 1;
    if (match.matchType === "strict") summary.strictMatches += 1;
    if (match.matchType !== "strict") summary.looseMatches += 1;
  }

  const unmatchedParents = sourceTransactions
    .filter(isVisible)
    .filter(isTopLevel)
    .filter((transaction) => !matchedSourceIds.has(transaction.id));

  for (const parent of unmatchedParents) {
    const sourceChildren = childrenByParent.get(parent.id) ?? [];
    const rowsToMove = [parent, ...sourceChildren].filter(isVisible);
    for (const row of rowsToMove) {
      await maybeUpdateTransaction(
        supabase,
        userId,
        row,
        { account_id: targetAccount.id, account: targetAccount.name },
        commit
      );
    }
    summary.movedParents += 1;
    summary.movedChildren += sourceChildren.filter(isVisible).length;
  }

  await maybeHideAccount(supabase, userId, sourceAccount, commit);
  return summary;
}

async function mergeDuplicatePlaidAccount({
  supabase,
  userId,
  sourceAccount,
  targetAccount,
  transactions,
  commit,
}) {
  const summary = {
    label: `${sourceAccount.name} -> ${targetAccount.name}`,
    matched: 0,
    targetUpdates: 0,
    categoryConflicts: 0,
    sourceRemoved: 0,
    unmatchedRemoved: 0,
  };
  const sourceTransactions = transactions.filter(
    (transaction) => transaction.account_id === sourceAccount.id
  );
  const targetTransactions = transactions.filter(
    (transaction) => transaction.account_id === targetAccount.id
  );
  const matches = matchTransactions(sourceTransactions, targetTransactions);
  const matchedSourceIds = new Set(matches.map((match) => match.source.id));

  for (const match of matches) {
    const { update, conflicts } = buildTargetUpdate(match.source, match.target);
    summary.categoryConflicts += conflicts.length;
    if (Object.keys(update).length > 0) {
      summary.targetUpdates += 1;
      await maybeUpdateTransaction(
        supabase,
        userId,
        match.target,
        update,
        commit
      );
    }
    summary.matched += 1;
  }

  for (const source of sourceTransactions.filter(isVisible)) {
    if (!matchedSourceIds.has(source.id) && isTopLevel(source)) {
      summary.unmatchedRemoved += 1;
    }
    summary.sourceRemoved += 1;
    await maybeUpdateTransaction(
      supabase,
      userId,
      source,
      { external_status: REMOVED },
      commit
    );
  }

  await maybeHideAccount(supabase, userId, sourceAccount, commit);
  return summary;
}

async function retireConnections({ supabase, userId, connections, commit }) {
  const summaries = [];
  for (const item of CONNECTIONS_TO_RETIRE) {
    const connection = resolveByPrefix(connections, item.id, item.label);
    summaries.push({
      label: item.label,
      id: shortId(connection.id),
      previousStatus: connection.status,
      newStatus: "inactive",
    });

    connection.status = "inactive";
    if (!commit) continue;

    const { error } = await supabase
      .from("bank_connections")
      .update({ status: "inactive" })
      .eq("id", connection.id)
      .eq("user_id", userId);
    if (error) throw error;
  }
  return summaries;
}

function printSummary({ mode, manualSummaries, duplicateSummaries, connectionSummaries }) {
  console.log(`Mode: ${mode}`);
  console.log("\nManual account merges");
  for (const summary of manualSummaries) {
    console.log(
      `- ${summary.label}: matched ${summary.matched} (${summary.strictMatches} strict, ${summary.looseMatches} loose), updated ${summary.targetUpdates}, removed ${summary.sourceRemoved}, moved ${summary.movedParents} parents/${summary.movedChildren} children, split children inserted ${summary.splitChildrenInserted}, category conflicts ${summary.categoryConflicts}`
    );
  }

  console.log("\nDuplicate Plaid account cleanup");
  for (const summary of duplicateSummaries) {
    console.log(
      `- ${summary.label}: matched ${summary.matched}, updated ${summary.targetUpdates}, removed ${summary.sourceRemoved}, unmatched removed ${summary.unmatchedRemoved}, category conflicts ${summary.categoryConflicts}`
    );
  }

  console.log("\nConnections");
  for (const summary of connectionSummaries) {
    console.log(
      `- ${summary.label}: ${summary.id} ${summary.previousStatus} -> ${summary.newStatus}`
    );
  }
}

async function main() {
  const env = parseEnv();
  const commit = isCommitMode();
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
        "id, name, institution, type, current_balance, hidden, user_id, connection_provider, external_account_id"
      )
      .eq("user_id", userId)
  );
  const connections = await fetchAll(() =>
    supabase
      .from("bank_connections")
      .select("id, institution_name, provider, status, user_id")
      .eq("provider", PROVIDER)
      .eq("user_id", userId)
  );
  const transactions = await fetchAll(() =>
    supabase
      .from("transactions")
      .select(
        "id, date, description, amount, category_id, category, account_id, account, status, source, upload_source, connection_provider, external_transaction_id, external_status, plaid_transaction_id, is_split, parent_id, not_duplicate, user_id"
      )
      .eq("user_id", userId)
  );

  const manualSummaries = [];
  for (const pair of MANUAL_ACCOUNT_MERGES) {
    manualSummaries.push(
      await mergeManualAccount({
        supabase,
        userId,
        sourceAccount: resolveByPrefix(accounts, pair.source, pair.label),
        targetAccount: resolveByPrefix(accounts, pair.target, pair.label),
        transactions,
        commit,
      })
    );
  }

  const duplicateSummaries = [];
  for (const pair of DUPLICATE_PLAID_ACCOUNT_MERGES) {
    duplicateSummaries.push(
      await mergeDuplicatePlaidAccount({
        supabase,
        userId,
        sourceAccount: resolveByPrefix(accounts, pair.source, pair.label),
        targetAccount: resolveByPrefix(accounts, pair.target, pair.label),
        transactions,
        commit,
      })
    );
  }

  const connectionSummaries = await retireConnections({
    supabase,
    userId,
    connections,
    commit,
  });

  printSummary({
    mode: commit ? "commit" : "dry-run",
    manualSummaries,
    duplicateSummaries,
    connectionSummaries,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
