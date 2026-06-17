import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { syncStoredTellerConnectionsForUser } from "@/lib/teller/sync";

export const runtime = "nodejs";

export async function POST() {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const summary = await syncStoredTellerConnectionsForUser(user.id);
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
