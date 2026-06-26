import { NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/api/errors";
import { syncStoredPlaidConnectionsForUser } from "@/lib/plaid/sync";
import { createServerClient } from "@/lib/supabase/server";

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

    const summary = await syncStoredPlaidConnectionsForUser(user.id);
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
