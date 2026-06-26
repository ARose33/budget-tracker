import { NextResponse, type NextRequest } from "next/server";
import { getErrorMessage } from "@/lib/api/errors";
import { saveAndSyncPlaidItem } from "@/lib/plaid/sync";
import { createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      public_token?: string;
      metadata?: unknown;
    };

    if (!body.public_token) {
      return NextResponse.json(
        { error: "Missing Plaid public token" },
        { status: 400 }
      );
    }

    const summary = await saveAndSyncPlaidItem(
      body.public_token,
      (body.metadata ?? {}) as Parameters<typeof saveAndSyncPlaidItem>[1],
      user.id
    );

    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
