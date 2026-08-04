import { NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/api/errors";
import { createPlaidUpdateLinkToken } from "@/lib/plaid/client";
import {
  createServerClient,
  createServiceRoleClient,
} from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  try {
    const authClient = await createServerClient();
    const {
      data: { user },
    } = await authClient.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { connectionId } = await params;
    const supabase = createServiceRoleClient();
    const { data: connection, error } = await supabase
      .from("bank_connections")
      .select("access_token")
      .eq("id", connectionId)
      .eq("provider", "plaid")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) throw error;
    if (!connection) {
      return NextResponse.json(
        { error: "Plaid connection not found" },
        { status: 404 }
      );
    }

    const token = await createPlaidUpdateLinkToken(
      user.id,
      connection.access_token
    );
    return NextResponse.json({ link_token: token.link_token });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
