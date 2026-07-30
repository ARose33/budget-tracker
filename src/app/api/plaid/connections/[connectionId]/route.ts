import { NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/api/errors";
import { getPlaidAccounts, removePlaidItem } from "@/lib/plaid/client";
import {
  createServerClient,
  createServiceRoleClient,
} from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function DELETE(
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
    const { data: connection, error: connectionError } = await supabase
      .from("bank_connections")
      .select("id, access_token")
      .eq("id", connectionId)
      .eq("provider", "plaid")
      .eq("user_id", user.id)
      .maybeSingle();

    if (connectionError) throw connectionError;
    if (!connection) {
      return NextResponse.json(
        { error: "Plaid connection not found" },
        { status: 404 }
      );
    }

    const plaidAccounts = await getPlaidAccounts(connection.access_token);
    const externalAccountIds = plaidAccounts.map(
      (account) => account.account_id
    );

    const { data: localAccounts, error: accountLookupError } = await supabase
      .from("accounts")
      .select("id")
      .eq("connection_provider", "plaid")
      .eq("user_id", user.id)
      .in("external_account_id", externalAccountIds);
    if (accountLookupError) throw accountLookupError;

    const localAccountIds = (localAccounts ?? []).map((account) => account.id);
    if (localAccountIds.length > 0) {
      const { error: transactionError } = await supabase
        .from("transactions")
        .update({ external_status: "removed" })
        .eq("user_id", user.id)
        .in("account_id", localAccountIds);
      if (transactionError) throw transactionError;

      const { error: accountError } = await supabase
        .from("accounts")
        .update({ hidden: true })
        .eq("user_id", user.id)
        .in("id", localAccountIds);
      if (accountError) throw accountError;
    }

    const { error: retireError } = await supabase
      .from("bank_connections")
      .update({ status: "inactive" })
      .eq("id", connection.id)
      .eq("user_id", user.id);
    if (retireError) throw retireError;

    await removePlaidItem(connection.access_token);

    const { error: deleteError } = await supabase
      .from("bank_connections")
      .delete()
      .eq("id", connection.id)
      .eq("user_id", user.id);
    if (deleteError) throw deleteError;

    return NextResponse.json({
      disconnected: true,
      accountsHidden: localAccountIds.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
