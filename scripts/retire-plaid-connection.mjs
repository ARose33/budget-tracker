import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

const PROVIDER = "plaid";
const REMOVED = "removed";

function getCliValue(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function parseEnv() {
  const explicitPath = getCliValue("env-file");
  const candidates = [
    explicitPath,
    ".env.production.local",
    ".env.local",
  ].filter(Boolean);
  const filePath = candidates
    .map((candidate) => path.resolve(candidate))
    .find((candidate) => fs.existsSync(candidate));
  const fileEnv = filePath
    ? Object.fromEntries(
        fs
          .readFileSync(filePath, "utf8")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .filter((line) => !line.startsWith("#"))
          .map((line) => {
            const index = line.indexOf("=");
            const key = line.slice(0, index);
            const rawValue = line.slice(index + 1);
            const value =
              rawValue.startsWith('"') && rawValue.endsWith('"')
                ? rawValue.slice(1, -1)
                : rawValue;
            return [key, value];
          })
      )
    : {};

  return { ...fileEnv, ...process.env };
}

function requiredEnv(env, name) {
  if (!env[name]) {
    throw new Error(`Missing ${name}.`);
  }
  return env[name];
}

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dayDifference(left, right) {
  const leftTime = new Date(`${left}T00:00:00Z`).getTime();
  const rightTime = new Date(`${right}T00:00:00Z`).getTime();
  return Math.abs(leftTime - rightTime) / 86_400_000;
}

function isMatchingTransaction(source, target) {
  return (
    Math.abs(Number(source.amount) - Number(target.amount)) <= 0.005 &&
    dayDifference(source.date, target.date) <= 2
  );
}

async function fetchAll(makeQuery) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery().range(
      from,
      from + pageSize - 1
    );
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function main() {
  const env = parseEnv();
  const connectionId = getCliValue("connection-id");
  const commit = process.argv.includes("--commit");

  if (!connectionId) {
    throw new Error("Pass --connection-id=<full-uuid>.");
  }

  const supabase = createClient(
    requiredEnv(env, "NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv(env, "SUPABASE_SERVICE_ROLE_KEY")
  );
  const plaidEnvironment = requiredEnv(env, "PLAID_ENV");
  if (!["sandbox", "production"].includes(plaidEnvironment)) {
    throw new Error("PLAID_ENV must be sandbox or production.");
  }
  const plaid = new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[plaidEnvironment],
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": requiredEnv(env, "PLAID_CLIENT_ID"),
          "PLAID-SECRET": requiredEnv(env, "PLAID_SECRET"),
        },
      },
    })
  );

  const { data: connection, error: connectionError } = await supabase
    .from("bank_connections")
    .select("id, access_token, institution_name, provider, status, user_id")
    .eq("id", connectionId)
    .eq("provider", PROVIDER)
    .single();
  if (connectionError) throw connectionError;
  if (!connection.user_id) {
    throw new Error("Connection is missing user_id.");
  }

  const plaidResponse = await plaid.accountsGet({
    access_token: connection.access_token,
  });
  const externalIds = plaidResponse.data.accounts.map(
    (account) => account.account_id
  );
  const sourceAccounts = await fetchAll(() =>
    supabase
      .from("accounts")
      .select("id, name, institution, type, external_account_id, hidden")
      .eq("user_id", connection.user_id)
      .eq("connection_provider", PROVIDER)
      .in("external_account_id", externalIds)
  );
  const allPlaidAccounts = await fetchAll(() =>
    supabase
      .from("accounts")
      .select("id, name, institution, type, external_account_id, hidden")
      .eq("user_id", connection.user_id)
      .eq("connection_provider", PROVIDER)
  );
  const sourceIds = new Set(sourceAccounts.map((account) => account.id));
  const mappings = sourceAccounts.map((source) => {
    const candidates = allPlaidAccounts.filter(
      (candidate) =>
        !sourceIds.has(candidate.id) &&
        normalize(candidate.institution) === normalize(source.institution) &&
        normalize(candidate.name) === normalize(source.name) &&
        candidate.type === source.type
    );
    if (candidates.length !== 1) {
      throw new Error(
        `${source.name}: expected one retained account, found ${candidates.length}.`
      );
    }
    return { source, target: candidates[0] };
  });

  const accountIds = mappings.flatMap(({ source, target }) => [
    source.id,
    target.id,
  ]);
  const transactions = await fetchAll(() =>
    supabase
      .from("transactions")
      .select("id, account_id, amount, date, parent_id, external_status")
      .eq("user_id", connection.user_id)
      .in("account_id", accountIds)
  );

  let visibleSourceTransactions = 0;
  let unmatchedTransactions = 0;
  for (const { source, target } of mappings) {
    const sourceTransactions = transactions.filter(
      (transaction) =>
        transaction.account_id === source.id &&
        !transaction.parent_id &&
        transaction.external_status !== REMOVED
    );
    const targetTransactions = transactions.filter(
      (transaction) =>
        transaction.account_id === target.id &&
        !transaction.parent_id &&
        transaction.external_status !== REMOVED
    );
    const unmatched = sourceTransactions.filter(
      (sourceTransaction) =>
        !targetTransactions.some((targetTransaction) =>
          isMatchingTransaction(sourceTransaction, targetTransaction)
        )
    );
    visibleSourceTransactions += sourceTransactions.length;
    unmatchedTransactions += unmatched.length;
    console.log(
      `${source.name}: ${sourceTransactions.length} duplicate transactions, ${unmatched.length} unmatched`
    );
  }

  console.log(
    `${commit ? "Commit" : "Dry run"}: retire ${
      connection.institution_name ?? connection.id
    }, hide ${sourceAccounts.length} accounts, remove ${visibleSourceTransactions} visible transactions`
  );

  if (!commit) return;
  if (unmatchedTransactions > 0) {
    throw new Error(
      `Refusing cleanup because ${unmatchedTransactions} transactions have no retained-account match.`
    );
  }

  await plaid.itemRemove({ access_token: connection.access_token });

  const { error: retireError } = await supabase
    .from("bank_connections")
    .update({ status: "inactive" })
    .eq("id", connection.id)
    .eq("user_id", connection.user_id);
  if (retireError) throw retireError;

  const sourceAccountIds = sourceAccounts.map((account) => account.id);
  const { error: transactionError } = await supabase
    .from("transactions")
    .update({ external_status: REMOVED })
    .eq("user_id", connection.user_id)
    .in("account_id", sourceAccountIds);
  if (transactionError) throw transactionError;

  const { error: accountError } = await supabase
    .from("accounts")
    .update({ hidden: true })
    .eq("user_id", connection.user_id)
    .in("id", sourceAccountIds);
  if (accountError) throw accountError;

  console.log(`Retired Plaid connection ${connection.id}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
