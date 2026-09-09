import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const { data, error } = await supabase.rpc("stackmint_reconciliation", {
    p_filters: Object.fromEntries(
      ["page", "status", "type", "year", "account"].flatMap((key) =>
        params.has(key) ? [[key, params.get(key)!]] : [],
      ),
    ),
    p_summary_only: params.get("summary") === "1",
  });
  if (error)
    return Response.json(
      {
        error: "Review data could not be loaded. Check the filters and retry.",
      },
      { status: 503 },
    );
  return Response.json(data);
}
export async function POST(request: Request) {
  const input = z
    .object({
      reviewId: z.string().uuid(),
      version: z.number().int().nonnegative(),
      decision: z.enum([
        "matched",
        "imported",
        "legitimate_duplicate",
        "ignored",
      ]),
      candidateTransactionId: z.string().uuid().nullish(),
      candidateVersion: z.number().int().nonnegative().nullish(),
      note: z.string().max(20000).nullish(),
    })
    .safeParse(await request.json().catch(() => null));
  if (!input.success)
    return Response.json(
      {
        error:
          "A review identity, observed version and valid decision are required",
      },
      { status: 400 },
    );
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  const value = input.data;
  const { data, error } = await supabase.rpc(
    "stackmint_resolve_reconciliation",
    {
      p_id: value.reviewId,
      p_version: value.version,
      p_decision: value.decision,
      p_candidate_id: value.candidateTransactionId,
      p_candidate_version: value.candidateVersion,
      p_note: value.note,
    },
  );
  if (error)
    return Response.json(
      {
        error:
          error.code === "P0001"
            ? error.message
            : "Could not save the decision. Reload to check whether it was saved before retrying.",
      },
      { status: 409 },
    );
  return Response.json({ result: data });
}
