import { NextResponse } from "next/server";
import { removePlaidItem } from "@/lib/plaid/client";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
export const runtime = "nodejs";
export async function DELETE(_request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  if (process.env.STACKMINT_ISOLATED === "true") return NextResponse.json({ error: "External disconnect is disabled in isolated verification." }, { status: 503 });
  const auth = await createServerClient();
  const { data: { user }, error: authError } = await auth.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { connectionId } = await params;
  const service = createServiceRoleClient();
  const { data: connection, error } = await service.from("bank_connections").select("id,access_token").eq("id", connectionId).eq("user_id", user.id).eq("provider", "plaid").maybeSingle();
  if (error || !connection) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  const { data: required, error: lockError } = await service.rpc("stackmint_begin_disconnect", { p_connection_id: connection.id, p_user_id: user.id });
  if (lockError) return NextResponse.json({ error: lockError.code === "55P03" ? "Wait for the current sync to finish before disconnecting." : "Could not prepare this connection for disconnect." }, { status: 409 });
  if (!required) return NextResponse.json({ disconnected: true, historyPreserved: true });
  try {
    await removePlaidItem(connection.access_token);
    const { data: saved, error: saveError } = await service.from("bank_connections").update({ status: "disconnected", error_code: null, error_message: null }).eq("id", connection.id).eq("user_id", user.id).select("id").single();
    if (saveError || !saved) throw new Error("Disconnect outcome could not be saved");
    return NextResponse.json({ disconnected: true, historyPreserved: true });
  } catch {
    await service.from("bank_connections").update({ status: "disconnect_failed", error_message: "Disconnect did not finish or its response was lost. History is retained; automatic sync is paused." }).eq("id", connection.id).eq("user_id", user.id);
    return NextResponse.json({ error: "Disconnect could not be confirmed. Your connection record, accounts and transactions are retained; automatic sync is paused." }, { status: 502 });
  }
}
