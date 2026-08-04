import { NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/api/errors";
import { syncPlaidConnectionByIdForUser } from "@/lib/plaid/sync";
import { createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { connectionId } = await params;
    const summary = await syncPlaidConnectionByIdForUser(connectionId, user.id);
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
