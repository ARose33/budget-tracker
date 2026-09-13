import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  createServerClient,
  createServiceRoleClient,
} from "@/lib/supabase/server";
export const runtime = "nodejs";
const hash = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
async function authenticated() {
  const client = await createServerClient();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user) return null;
  return user;
}
async function readNote(userId: string, transactionId: string) {
  const service = createServiceRoleClient();
  const { data: owned, error: ownershipError } = await service
    .from("transactions")
    .select("id")
    .eq("id", transactionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (ownershipError) throw new Error("Could not verify transaction");
  if (!owned) return null;
  const { data: latest, error } = await service
    .from("transaction_note_versions")
    .select("version,content")
    .eq("user_id", userId)
    .eq("transaction_id", transactionId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("Note history unavailable");
  if (latest)
    return {
      content: latest.content,
      version: latest.version,
      hash: hash(latest.content),
    };
  const { data, error: storageError } = await service.storage
    .from("transaction-notes")
    .download(userId + "/" + transactionId + ".txt");
  // A failed read is not an empty note. Only the documented missing-object code is absence.
  if (
    storageError &&
    !("statusCode" in storageError && String(storageError.statusCode) === "404")
  )
    throw new Error("Note storage unavailable");
  const content = data ? await data.text() : "";
  return { content, version: 0, hash: hash(content) };
}
export async function GET(request: Request) {
  try {
    const user = await authenticated();
    if (!user) return json({ error: "Unauthorized" }, 401);
    const id = z
      .string()
      .uuid()
      .safeParse(new URL(request.url).searchParams.get("ids"));
    if (!id.success) return json({ error: "Choose one transaction note" }, 400);
    const note = await readNote(user.id, id.data);
    if (!note) return json({ error: "Transaction not found" }, 404);
    return json(note);
  } catch {
    return json(
      { error: "This note could not be loaded. Retry before editing." },
      503,
    );
  }
}
export async function PUT(request: Request) {
  try {
    const user = await authenticated();
    if (!user) return json({ error: "Unauthorized" }, 401);
    const input = z
      .object({
        transactionId: z.string().uuid(),
        notes: z.string().max(2000),
        expectedVersion: z.number().int().nonnegative(),
        expectedHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .safeParse(await request.json());
    if (!input.success)
      return json({ error: "Invalid note or missing saved version" }, 400);
    const value = input.data;
    const current = await readNote(user.id, value.transactionId);
    if (!current) return json({ error: "Transaction not found" }, 404);
    if (
      current.version !== value.expectedVersion ||
      current.hash !== value.expectedHash
    )
      return json({ error: "This note changed. Reload before saving." }, 409);
    const service = createServiceRoleClient();
    const { data: version, error } = await service.rpc("stackmint_write_note", {
      p_user_id: user.id,
      p_transaction_id: value.transactionId,
      p_expected_version: value.expectedVersion,
      p_legacy_content: current.content,
      p_content: value.notes,
    });
    if (error)
      return json(
        {
          error:
            error.code === "PT409" || error.code === "40001"
              ? "This note changed. Reload before saving."
              : "The note could not be saved.",
        },
        error.code === "PT409" || error.code === "40001" ? 409 : 503,
      );
    return json({ content: value.notes, version, hash: hash(value.notes) });
  } catch {
    return json({ error: "The note could not be saved." }, 503);
  }
}
