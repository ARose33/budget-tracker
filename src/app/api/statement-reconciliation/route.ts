import { NextResponse } from "next/server";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/api/errors";

export const runtime = "nodejs";

async function authenticatedUser() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function GET(request: Request) {
  try {
    const { user } = await authenticatedUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const params = new URL(request.url).searchParams;
    const service = createServiceRoleClient();
    const { data: allReviews, error: summaryError } = await service
      .from("statement_reconciliation_reviews")
      .select("review_type,status,amount,proposed_date,account_name")
      .eq("user_id", user.id).limit(5000);
    if (summaryError) throw summaryError;
    const pending = allReviews.filter((row) => row.status === "pending");

    const summary = {
      total: pending.length,
      reviewed: allReviews.length - pending.length,
      totalQueue: allReviews.length,
      amount: pending.reduce((sum, row) => sum + Number(row.amount), 0),
      byType: Object.fromEntries(["proposed_import", "possible_match", "conflict", "likely_duplicate"]
        .map((type) => [type, pending.filter((row) => row.review_type === type).length])),
      years: [...new Set(pending.map((row) => row.proposed_date.slice(0, 4)))].sort(),
      accounts: [...new Set(pending.map((row) => row.account_name).filter(Boolean))].sort(),
    };
    if (params.get("summary") === "1") return NextResponse.json({ summary });

    const page = Math.max(1, Number(params.get("page")) || 1);
    const pageSize = 1;
    let query = service.from("statement_reconciliation_reviews").select("*", { count: "exact" })
      .eq("user_id", user.id).eq("status", params.get("status") || "pending")
      .order("proposed_date", { ascending: true }).order("created_at", { ascending: true });
    const type = params.get("type");
    const year = params.get("year");
    const account = params.get("account");
    if (type && type !== "all") query = query.eq("review_type", type);
    if (year && year !== "all") query = query.gte("proposed_date", `${year}-01-01`).lte("proposed_date", `${year}-12-31`);
    if (account && account !== "all") query = query.eq("account_name", account);
    const { data, count, error } = await query.range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw error;
    const candidateIds = [...new Set((data ?? []).flatMap((item) => item.candidate_transaction_ids))];
    const { data: candidateRows, error: candidateError } = candidateIds.length
      ? await service.from("transactions")
          .select("id,date,amount,description,source,connection_provider")
          .eq("user_id", user.id).in("id", candidateIds)
      : { data: [], error: null };
    if (candidateError) throw candidateError;
    const liveCandidates = new Map((candidateRows ?? []).map((candidate) => [candidate.id, {
      id: candidate.id, date: candidate.date, amount: candidate.amount,
      description: candidate.description ?? "No description", source: candidate.source,
      connectionProvider: candidate.connection_provider,
    }]));
    const items = (data ?? []).map((item) => ({
      ...item,
      candidates: item.candidate_transaction_ids
        .map((id) => liveCandidates.get(id)).filter(Boolean),
    }));
    return NextResponse.json({ items, count: count ?? 0, page, pageSize, summary });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await authenticatedUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json() as {
      reviewId?: string; decision?: string; candidateTransactionId?: string | null; note?: string | null;
    };
    if (!body.reviewId || !body.decision) {
      return NextResponse.json({ error: "Review item and decision are required" }, { status: 400 });
    }
    const { data, error } = await supabase.rpc("resolve_statement_reconciliation_review", {
      p_review_id: body.reviewId,
      p_decision: body.decision,
      p_candidate_transaction_id: body.candidateTransactionId ?? null,
      p_note: body.note ?? null,
    });
    if (error) throw error;
    return NextResponse.json({ result: data });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
