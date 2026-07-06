import { NextResponse, type NextRequest } from "next/server";
import { getErrorMessage } from "@/lib/api/errors";
import { syncPlaidConnectionByItemId } from "@/lib/plaid/sync";

export const runtime = "nodejs";

function isAuthorized(request: NextRequest) {
  const expectedSecret = process.env.PLAID_WEBHOOK_SECRET;
  if (!expectedSecret) return true;

  const querySecret = request.nextUrl.searchParams.get("secret");
  const authHeader = request.headers.get("authorization");
  return (
    querySecret === expectedSecret || authHeader === `Bearer ${expectedSecret}`
  );
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const webhook = (await request.json()) as {
      webhook_type?: string;
      webhook_code?: string;
      item_id?: string;
    };

    if (webhook.webhook_type !== "TRANSACTIONS" || !webhook.item_id) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    const syncableCodes = new Set([
      "SYNC_UPDATES_AVAILABLE",
      "INITIAL_UPDATE",
      "HISTORICAL_UPDATE",
      "DEFAULT_UPDATE",
      "TRANSACTIONS_REMOVED",
    ]);

    if (!webhook.webhook_code || !syncableCodes.has(webhook.webhook_code)) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    const summary = await syncPlaidConnectionByItemId(webhook.item_id);
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
