import { readFileSync } from "node:fs";
import { request as httpsRequest, type RequestOptions } from "node:https";

const TELLER_API_BASE_URL = "https://api.teller.io";
const TELLER_VERSION = "2019-07-01";

export interface TellerEnrollmentPayload {
  accessToken: string;
  user?: {
    id?: string;
  };
  enrollment: {
    id: string;
    institution?: {
      name?: string;
    };
  };
  signatures?: string[];
  environment?: string;
}

export interface TellerAccount {
  id: string;
  enrollment_id: string;
  name: string;
  type: string;
  subtype?: string | null;
  currency: string;
  last_four?: string | null;
  status: string;
  institution: {
    id: string;
    name: string;
  };
  links?: {
    balances?: string;
    transactions?: string;
  };
}

export interface TellerBalances {
  account_id: string;
  ledger: string | null;
  available: string | null;
}

export interface TellerTransaction {
  id: string;
  account_id: string;
  amount: string;
  date: string;
  description: string;
  status: string;
  type: string;
  running_balance: string | null;
}

export class TellerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TellerConfigError";
  }
}

function getTellerEnvironment() {
  return process.env.TELLER_ENVIRONMENT || "sandbox";
}

export function getTellerConnectConfig() {
  const applicationId = process.env.TELLER_APPLICATION_ID;
  if (!applicationId) {
    throw new TellerConfigError("Missing TELLER_APPLICATION_ID");
  }

  return {
    applicationId,
    environment: getTellerEnvironment(),
    products: ["balance", "transactions"],
    selectAccount: "multiple",
  };
}

export function getTellerServerConfigStatus() {
  const environment = getTellerEnvironment();
  const hasApplicationId = Boolean(process.env.TELLER_APPLICATION_ID);
  const hasCertificate = Boolean(process.env.TELLER_CERTIFICATE);
  const hasPrivateKey = Boolean(process.env.TELLER_PRIVATE_KEY);
  const hasServiceRoleKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  return {
    environment,
    hasApplicationId,
    hasCertificate,
    hasPrivateKey,
    hasServiceRoleKey,
    mtlsRequired: environment !== "sandbox",
    ready:
      hasApplicationId &&
      hasServiceRoleKey &&
      (environment === "sandbox" || (hasCertificate && hasPrivateKey)),
  };
}

function normalizePem(value: string) {
  const trimmed = value.trim();
  if (trimmed.includes("-----BEGIN")) {
    return trimmed.replaceAll("\\n", "\n");
  }
  return readFileSync(trimmed, "utf8");
}

function getMtlsOptions() {
  const environment = getTellerEnvironment();
  const certificate = process.env.TELLER_CERTIFICATE;
  const privateKey = process.env.TELLER_PRIVATE_KEY;

  if (environment !== "sandbox" && (!certificate || !privateKey)) {
    throw new TellerConfigError(
      "TELLER_CERTIFICATE and TELLER_PRIVATE_KEY are required outside sandbox"
    );
  }

  if (!certificate || !privateKey) return {};

  return {
    cert: normalizePem(certificate),
    key: normalizePem(privateKey),
  };
}

function buildPath(pathname: string, query?: Record<string, string | undefined>) {
  const url = new URL(pathname, TELLER_API_BASE_URL);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value) url.searchParams.set(key, value);
  }
  return `${url.pathname}${url.search}`;
}

function mockTellerResponse<T>(pathname: string): T {
  if (pathname === "/accounts") {
    return [
      {
        id: "acc_mock_checking",
        enrollment_id: "enr_mock_budget_tracker",
        name: "Mock Checking",
        type: "depository",
        subtype: "checking",
        currency: "USD",
        last_four: "0001",
        status: "open",
        institution: {
          id: "mock_bank",
          name: "Mock Bank",
        },
        links: {
          balances:
            "https://api.teller.io/accounts/acc_mock_checking/balances",
          transactions:
            "https://api.teller.io/accounts/acc_mock_checking/transactions",
        },
      },
      {
        id: "acc_mock_credit",
        enrollment_id: "enr_mock_budget_tracker",
        name: "Mock Credit Card",
        type: "credit",
        subtype: "credit_card",
        currency: "USD",
        last_four: "0002",
        status: "open",
        institution: {
          id: "mock_bank",
          name: "Mock Bank",
        },
        links: {
          balances:
            "https://api.teller.io/accounts/acc_mock_credit/balances",
          transactions:
            "https://api.teller.io/accounts/acc_mock_credit/transactions",
        },
      },
    ] as T;
  }

  if (pathname.endsWith("/balances")) {
    const accountId = pathname.split("/")[2];
    return {
      account_id: accountId,
      ledger: accountId === "acc_mock_credit" ? "342.91" : "2450.33",
      available: accountId === "acc_mock_credit" ? "342.91" : "2450.33",
    } as T;
  }

  if (pathname.endsWith("/transactions")) {
    const accountId = pathname.split("/")[2];
    return [
      {
        id: `${accountId}_txn_001`,
        account_id: accountId,
        amount: "18.42",
        date: "2026-05-25",
        description: "Mock Coffee Shop",
        status: "posted",
        type: "card_payment",
        running_balance: null,
      },
      {
        id: `${accountId}_txn_002`,
        account_id: accountId,
        amount: "-125.00",
        date: "2026-05-24",
        description: "Mock Payroll",
        status: "posted",
        type: "deposit",
        running_balance: null,
      },
    ] as T;
  }

  throw new Error(`No mock Teller response for ${pathname}`);
}

async function tellerRequest<T>(
  accessToken: string,
  pathname: string,
  query?: Record<string, string | undefined>
): Promise<T> {
  if (accessToken.startsWith("mock_")) {
    return mockTellerResponse<T>(pathname);
  }

  const path = buildPath(pathname, query);
  const auth = Buffer.from(`${accessToken}:`).toString("base64");
  const mtlsOptions = getMtlsOptions();

  const options: RequestOptions = {
    ...mtlsOptions,
    method: "GET",
    hostname: "api.teller.io",
    path,
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Teller-Version": TELLER_VERSION,
    },
  };

  return new Promise((resolve, reject) => {
    const req = httpsRequest(options, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        const status = res.statusCode ?? 500;
        if (status < 200 || status >= 300) {
          reject(
            new Error(
              `Teller request failed (${status}): ${body || res.statusMessage}`
            )
          );
          return;
        }

        try {
          resolve(JSON.parse(body) as T);
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

export function listTellerAccounts(accessToken: string) {
  return tellerRequest<TellerAccount[]>(accessToken, "/accounts");
}

export function getTellerBalances(accessToken: string, accountId: string) {
  return tellerRequest<TellerBalances>(
    accessToken,
    `/accounts/${encodeURIComponent(accountId)}/balances`
  );
}

export function listTellerTransactions(
  accessToken: string,
  accountId: string,
  startDate?: string,
  endDate?: string
) {
  return tellerRequest<TellerTransaction[]>(
    accessToken,
    `/accounts/${encodeURIComponent(accountId)}/transactions`,
    {
      start_date: startDate,
      end_date: endDate,
    }
  );
}
