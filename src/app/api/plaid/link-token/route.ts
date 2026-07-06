import { NextResponse } from "next/server";
import { createPlaidLinkToken } from "@/lib/plaid/client";
import { getErrorMessage } from "@/lib/api/errors";
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

    const token = await createPlaidLinkToken(user.id);
    return NextResponse.json(token);
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
