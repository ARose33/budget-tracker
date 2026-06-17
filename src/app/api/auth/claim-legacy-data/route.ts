import { NextResponse } from "next/server";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";

const tables = [
  "accounts",
  "budget_categories",
  "budgets",
  "transactions",
  "plaid_items",
] as const;

export async function POST() {
  if (process.env.ALLOW_LEGACY_DATA_CLAIM !== "true") {
    return NextResponse.json(
      { error: "Legacy data claim is disabled" },
      { status: 403 }
    );
  }

  const sessionClient = await createServerClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceClient = createServiceRoleClient();
  const results: Record<string, string | null> = {};

  for (const table of tables) {
    const { error } = await serviceClient
      .from(table)
      .update({ user_id: user.id })
      .neq("user_id", user.id);

    results[table] = error?.message ?? null;
  }

  return NextResponse.json({ claimedFor: user.id, results });
}
