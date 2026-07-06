import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
} from "plaid";

const PLAID_PRODUCTS = [Products.Transactions];
const PLAID_COUNTRY_CODES = [CountryCode.Us];
const PLAID_HISTORY_DAYS = 730;

export class PlaidConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaidConfigError";
  }
}

function getPlaidEnvironment() {
  const environment = process.env.PLAID_ENV ?? "sandbox";
  if (!["sandbox", "production"].includes(environment)) {
    throw new PlaidConfigError("PLAID_ENV must be sandbox or production");
  }
  return environment as "sandbox" | "production";
}

function getPlaidSecret() {
  const secret = process.env.PLAID_SECRET;
  if (!secret) {
    throw new PlaidConfigError("Missing PLAID_SECRET");
  }
  return secret;
}

function getPlaidClientId() {
  const clientId = process.env.PLAID_CLIENT_ID;
  if (!clientId) {
    throw new PlaidConfigError("Missing PLAID_CLIENT_ID");
  }
  return clientId;
}

function getSiteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(
    /\/$/,
    ""
  );
}

export function getPlaidClient() {
  const environment = getPlaidEnvironment();
  const configuration = new Configuration({
    basePath: PlaidEnvironments[environment],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": getPlaidClientId(),
        "PLAID-SECRET": getPlaidSecret(),
      },
    },
  });

  return new PlaidApi(configuration);
}

export function getPlaidServerConfigStatus() {
  const environment = process.env.PLAID_ENV ?? "sandbox";
  const hasClientId = Boolean(process.env.PLAID_CLIENT_ID);
  const hasSecret = Boolean(process.env.PLAID_SECRET);
  const hasServiceRoleKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  return {
    environment,
    hasClientId,
    hasSecret,
    hasServiceRoleKey,
    ready: hasClientId && hasSecret && hasServiceRoleKey,
  };
}

export function getPlaidWebhookUrl() {
  const webhookSecret = process.env.PLAID_WEBHOOK_SECRET;
  const url = new URL("/api/plaid/webhook", getSiteUrl());
  if (webhookSecret) {
    url.searchParams.set("secret", webhookSecret);
  }
  return url.toString();
}

export async function createPlaidLinkToken(userId: string) {
  const client = getPlaidClient();
  const response = await client.linkTokenCreate({
    user: {
      client_user_id: userId,
    },
    client_name: "Budget Tracker",
    products: PLAID_PRODUCTS,
    country_codes: PLAID_COUNTRY_CODES,
    language: "en",
    webhook: getPlaidWebhookUrl(),
    transactions: {
      days_requested: PLAID_HISTORY_DAYS,
    },
  });

  return response.data;
}

export async function exchangePlaidPublicToken(publicToken: string) {
  const client = getPlaidClient();
  const response = await client.itemPublicTokenExchange({
    public_token: publicToken,
  });
  return response.data;
}

export async function getPlaidItem(accessToken: string) {
  const client = getPlaidClient();
  const response = await client.itemGet({ access_token: accessToken });
  return response.data.item;
}

export async function getPlaidAccounts(accessToken: string) {
  const client = getPlaidClient();
  const response = await client.accountsGet({ access_token: accessToken });
  return response.data.accounts;
}

export async function syncPlaidTransactions(
  accessToken: string,
  cursor: string | null
) {
  const client = getPlaidClient();
  const response = await client.transactionsSync({
    access_token: accessToken,
    cursor: cursor ?? undefined,
    count: 500,
    options: {
      days_requested: PLAID_HISTORY_DAYS,
      include_original_description: true,
    },
  });
  return response.data;
}
