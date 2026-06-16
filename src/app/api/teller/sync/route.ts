import { NextResponse } from "next/server";
import { syncStoredTellerConnections } from "@/lib/teller/sync";

export const runtime = "nodejs";

export async function POST() {
  try {
    const summary = await syncStoredTellerConnections();
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
