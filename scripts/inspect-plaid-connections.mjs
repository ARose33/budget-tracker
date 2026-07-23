import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

const PROVIDER = "plaid";

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

function requiredEnv(env, name) {
  if (!env[name]) {
    throw new Error(`Missing ${name}. Add it to .env.local or the environment.`);
  }
  return env[name];
}

function shortId(id) {
  return id ? id.slice(0, 8) : "";
}

function getCliValue(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

async function fetchAll(makeQuery) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await makeQuery().range(from, to);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
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

function createPlaidClient(env) {
  const plaidEnv = getCliValue("plaid-env") || env.PLAID_ENV || "sandbox";
  if (!["sandbox", "production"].includes(plaidEnv)) {
    throw new Error("PLAID_ENV must be sandbox or production.");
  }

  return new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[plaidEnv],
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": requiredEnv(env, "PLAID_CLIENT_ID"),
          "PLAID-SECRET": requiredEnv(env, "PLAID_SECRET"),
        },
      },
    })
  );
}

function accountDisplayName(account) {
  return account.mask ? `${account.name} (...${account.mask})` : account.name;
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
  const institution = getCliValue("institution");
  const plaid = createPlaidClient(env);

  let connectionQuery = supabase
    .from("bank_connections")
    .select(
      "id, provider_enrollment_id, access_token, institution_name, institution_id, status, last_synced_at, user_id"
    )
    .eq("provider", PROVIDER)
    .eq("user_id", userId)
    .order("institution_name");

  if (institution) {
    connectionQuery = connectionQuery.ilike("institution_name", `%${institution}%`);
  }

  const { data: connections, error: connectionError } = await connectionQuery;
  if (connectionError) throw connectionError;

  const accounts = await fetchAll(() =>
    supabase
      .from("accounts")
      .select(
        "id, name, institution, type, current_balance, external_account_id, connection_provider, hidden, last_synced_at"
      )
      .eq("user_id", userId)
      .eq("connection_provider", PROVIDER)
  );
  const accountsByExternalId = new Map(
    accounts.map((account) => [account.external_account_id, account])
  );

  for (const connection of connections ?? []) {
    console.log(
      `Connection ${shortId(connection.id)} | ${connection.institution_name ?? "Unknown"} | ${connection.status} | synced ${connection.last_synced_at ?? "never"}`
    );

    let response;
    try {
      response = await plaid.accountsGet({
        access_token: connection.access_token,
      });
    } catch (error) {
      const plaidError = error?.response?.data;
      if (plaidError?.error_code) {
        console.log(
          `- Plaid error ${plaidError.error_code}: ${plaidError.error_message}`
        );
        continue;
      }
      throw error;
    }

    for (const plaidAccount of response.data.accounts) {
      const local = accountsByExternalId.get(plaidAccount.account_id);
      const localLabel = local
        ? `${shortId(local.id)} ${local.name} (${local.type ?? "unknown"})`
        : "no local row";
      console.log(
        `- ${accountDisplayName(plaidAccount)} | Plaid ${shortId(plaidAccount.account_id)} | local ${localLabel}`
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
