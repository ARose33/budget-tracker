import { NextResponse, type NextRequest } from "next/server";
import { getErrorMessage } from "@/lib/api/errors";
import { syncAllStoredPlaidConnections } from "@/lib/plaid/sync";

export const runtime = "nodejs";

function getExpectedToken() {
  return process.env.PLAID_SYNC_CRON_SECRET ?? process.env.CRON_SECRET;
}

function isAuthorized(request: NextRequest) {
  const expectedToken = getExpectedToken();
  if (!expectedToken) return false;

  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${expectedToken}`;
}

async function handleCronSync(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await syncAllStoredPlaidConnections();
    return NextResponse.json({
      ...summary,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return handleCronSync(request);
}

export async function POST(request: NextRequest) {
  return handleCronSync(request);
}
