import { NextResponse } from "next/server";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/api/errors";

export const runtime = "nodejs";

const BUCKET = "transaction-notes";
const MAX_NOTE_LENGTH = 2000;

async function getUser() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

async function getOwnedTransactionIds(userId: string, transactionIds: string[]) {
  const service = createServiceRoleClient();
  const { data, error } = await service
    .from("transactions")
    .select("id")
    .eq("user_id", userId)
    .in("id", transactionIds);

  if (error) throw error;
  return new Set((data ?? []).map((transaction) => transaction.id));
}

export async function GET(request: Request) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const requestedIds = new URL(request.url).searchParams
      .get("ids")
      ?.split(",")
      .filter(Boolean)
      .slice(0, 50) ?? [];

    if (requestedIds.length === 0) {
      return NextResponse.json({ notes: {} });
    }

    const ownedIds = await getOwnedTransactionIds(user.id, requestedIds);
    const service = createServiceRoleClient();
    const notes: Record<string, string> = {};

    await Promise.all(
      [...ownedIds].map(async (transactionId) => {
        const { data, error } = await service.storage
          .from(BUCKET)
          .download(`${user.id}/${transactionId}.txt`);

        if (!error && data) {
          notes[transactionId] = await data.text();
        }
      })
    );

    return NextResponse.json({ notes });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      transactionId?: string;
      notes?: string | null;
    };
    const transactionId = body.transactionId?.trim();
    const notes = body.notes?.trim() || null;

    if (!transactionId) {
      return NextResponse.json(
        { error: "Transaction ID is required" },
        { status: 400 }
      );
    }
    if (notes && notes.length > MAX_NOTE_LENGTH) {
      return NextResponse.json(
        { error: `Notes cannot exceed ${MAX_NOTE_LENGTH} characters` },
        { status: 400 }
      );
    }

    const ownedIds = await getOwnedTransactionIds(user.id, [transactionId]);
    if (!ownedIds.has(transactionId)) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    const service = createServiceRoleClient();
    const path = `${user.id}/${transactionId}.txt`;

    if (notes) {
      const { error } = await service.storage
        .from(BUCKET)
        .upload(path, notes, {
          contentType: "text/plain; charset=utf-8",
          upsert: true,
        });
      if (error) throw error;
    } else {
      const { error } = await service.storage.from(BUCKET).remove([path]);
      if (error && !error.message.toLowerCase().includes("not found")) throw error;
    }

    return NextResponse.json({ notes });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
