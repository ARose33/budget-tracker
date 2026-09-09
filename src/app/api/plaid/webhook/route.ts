import { NextResponse, type NextRequest } from "next/server";
import { syncPlaidConnectionByItemId } from "@/lib/plaid/sync";
import { getPlaidClient } from "@/lib/plaid/client";
import { verifyPlaidWebhook } from "@/lib/plaid/webhook-verification";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (rawBody.length > 100_000)
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  const verified = await verifyPlaidWebhook(
    request.headers.get("plaid-verification"),
    rawBody,
    async (keyId) => ({
      ...(await getPlaidClient().webhookVerificationKeyGet({ key_id: keyId }))
        .data.key,
    }),
  );
  if (!verified)
    return NextResponse.json(
      { error: "Invalid webhook signature" },
      { status: 401 },
    );
  try {
    const webhook = JSON.parse(rawBody) as {
      webhook_type?: string;
      webhook_code?: string;
      item_id?: string;
    };
    const codes = new Set([
      "SYNC_UPDATES_AVAILABLE",
      "INITIAL_UPDATE",
      "HISTORICAL_UPDATE",
      "DEFAULT_UPDATE",
      "TRANSACTIONS_REMOVED",
    ]);
    if (
      webhook.webhook_type !== "TRANSACTIONS" ||
      !webhook.item_id ||
      !webhook.webhook_code ||
      !codes.has(webhook.webhook_code)
    ) {
      return NextResponse.json({ ok: true, ignored: true });
    }
    await syncPlaidConnectionByItemId(webhook.item_id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Webhook processing failed; retry later." },
      { status: 503 },
    );
  }
}
