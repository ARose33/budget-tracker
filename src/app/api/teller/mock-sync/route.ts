import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { saveAndSyncTellerEnrollment } from "@/lib/teller/sync";
import {
  getTellerBalances,
  listTellerAccounts,
  listTellerTransactions,
} from "@/lib/teller/client";
import { createServerClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/api/errors";

export const runtime = "nodejs";

async function dryRunMockSync() {
  const accessToken = "mock_teller_access_token";
  const accounts = await listTellerAccounts(accessToken);
  let transactionCount = 0;

  for (const account of accounts) {
    await getTellerBalances(accessToken, account.id);
    const transactions = await listTellerTransactions(
      accessToken,
      account.id,
      "2026-05-01",
      "2026-05-26"
    );
    transactionCount += transactions.length;
  }

  return {
    connections: 1,
    accounts: accounts.length,
    transactions: transactionCount,
    dryRun: true,
  };
}

export async function POST(request: NextRequest) {
  if (request.nextUrl.searchParams.get("dryRun") === "true") {
    return NextResponse.json(await dryRunMockSync());
  }

  if (process.env.TELLER_ENABLE_MOCK_SYNC !== "true") {
    return NextResponse.json(
      { error: "Set TELLER_ENABLE_MOCK_SYNC=true to run mock Teller sync" },
      { status: 403 }
    );
  }

  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const summary = await saveAndSyncTellerEnrollment({
      accessToken: "mock_teller_access_token",
      enrollment: {
        id: "enr_mock_budget_tracker",
        institution: {
          name: "Mock Bank",
        },
      },
      environment: "sandbox",
      user: {
        id: "usr_mock_budget_tracker",
      },
    }, user.id);

    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
