import {
  Configuration,
  CountryCode,
  type LinkTokenCreateRequest,
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

interface PlaidErrorResponse {
  error_type?: unknown;
  error_code?: unknown;
  error_message?: unknown;
  display_message?: unknown;
  request_id?: unknown;
}

interface PlaidHttpError {
  response?: {
    status?: unknown;
    data?: PlaidErrorResponse;
  };
}

export class PlaidRequestError extends Error {
  readonly errorType: string | null;
  readonly errorCode: string | null;
  readonly requestId: string | null;
  readonly status: number | null;

  constructor(input: {
    message: string;
    errorType: string | null;
    errorCode: string | null;
    requestId: string | null;
    status: number | null;
  }) {
    super(input.message);
    this.name = "PlaidRequestError";
    this.errorType = input.errorType;
    this.errorCode = input.errorCode;
    this.requestId = input.requestId;
    this.status = input.status;
  }
}

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function userFacingPlaidMessage(
  errorCode: string | null,
  displayMessage: string | null,
  errorMessage: string | null
) {
  if (displayMessage) return displayMessage;

  switch (errorCode) {
    case "ITEM_LOGIN_REQUIRED":
      return "This bank connection needs to be reconnected before it can sync.";
    case "INVALID_CREDENTIALS":
      return "The bank rejected the saved credentials. Reconnect the account to continue syncing.";
    case "ITEM_LOCKED":
      return "This bank account is locked. Unlock it with the bank, then reconnect it here.";
    case "INSTITUTION_DOWN":
    case "INSTITUTION_NOT_RESPONDING":
      return "The bank is temporarily unavailable. Try syncing again later.";
    case "INVALID_ACCESS_TOKEN":
      return "This Plaid connection is invalid for the configured environment and must be reconnected.";
    case "INVALID_API_KEYS":
      return "Plaid rejected the configured API credentials.";
    default:
      return errorMessage
        ? `Plaid error${errorCode ? ` (${errorCode})` : ""}: ${errorMessage}`
        : `Plaid request failed${errorCode ? ` (${errorCode})` : ""}.`;
  }
}

export function normalizePlaidError(error: unknown) {
  if (error instanceof PlaidRequestError) return error;

  const httpError = error as PlaidHttpError;
  const response = httpError?.response;
  const data = response?.data;
  if (!data || typeof data !== "object") return null;

  const errorType = asNonEmptyString(data.error_type);
  const errorCode = asNonEmptyString(data.error_code);
  const errorMessage = asNonEmptyString(data.error_message);
  const displayMessage = asNonEmptyString(data.display_message);
  const requestId = asNonEmptyString(data.request_id);
  const status =
    typeof response.status === "number" && Number.isFinite(response.status)
      ? response.status
      : null;

  return new PlaidRequestError({
    message: userFacingPlaidMessage(errorCode, displayMessage, errorMessage),
    errorType,
    errorCode,
    requestId,
    status,
  });
}

async function plaidRequest<T>(request: () => Promise<T>) {
  try {
    return await request();
  } catch (error) {
    throw normalizePlaidError(error) ?? error;
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
  const response = await plaidRequest(() => client.linkTokenCreate({
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
  }));

  return response.data;
}

export async function createPlaidUpdateLinkToken(
  userId: string,
  accessToken: string
) {
  const client = getPlaidClient();
  const request: LinkTokenCreateRequest = {
    user: {
      client_user_id: userId,
    },
    client_name: "Budget Tracker",
    country_codes: PLAID_COUNTRY_CODES,
    language: "en",
    access_token: accessToken,
  };
  const response = await plaidRequest(() => client.linkTokenCreate(request));
  return response.data;
}

export async function exchangePlaidPublicToken(publicToken: string) {
  const client = getPlaidClient();
  const response = await plaidRequest(() => client.itemPublicTokenExchange({
    public_token: publicToken,
  }));
  return response.data;
}

export async function getPlaidItem(accessToken: string) {
  const client = getPlaidClient();
  const response = await plaidRequest(() =>
    client.itemGet({ access_token: accessToken })
  );
  return response.data.item;
}

export async function getPlaidAccounts(accessToken: string) {
  const client = getPlaidClient();
  const response = await plaidRequest(() =>
    client.accountsGet({ access_token: accessToken })
  );
  return response.data.accounts;
}

export async function removePlaidItem(accessToken: string) {
  const client = getPlaidClient();
  const response = await plaidRequest(() =>
    client.itemRemove({ access_token: accessToken })
  );
  return response.data;
}

export async function syncPlaidTransactions(
  accessToken: string,
  cursor: string | null
) {
  const client = getPlaidClient();
  const response = await plaidRequest(() => client.transactionsSync({
    access_token: accessToken,
    cursor: cursor ?? undefined,
    count: 500,
    options: {
      days_requested: PLAID_HISTORY_DAYS,
      include_original_description: true,
    },
  }));
  return response.data;
}
