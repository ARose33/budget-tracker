import { z } from "zod";
import { supabase } from "@/lib/supabase/client";
const values = z.object({
  date: z.string().optional(), description: z.string().nullable().optional(), amount: z.number().optional(),
  account_id: z.string().nullable().optional(), current_balance: z.number().nullable().optional(), row_version: z.number().optional(),
});
const rowSchema = z.object({
  id: z.string(), entity_type: z.enum(["account", "transaction"]), entity_id: z.string().nullable(),
  reason: z.string(), status: z.string(), created_at: z.string(), proposed_values: values, current: values.nullable(), existing_values: values.nullable(),
  candidates: z.array(z.object({ id: z.string(), date: z.string(), description: z.string().nullable(), amount: z.number() })),
});
export type ProviderReview = z.infer<typeof rowSchema>;
export async function getProviderReviews(status: string, page = 0) {
  const { data, error } = await supabase.rpc("stackmint_provider_reviews", { p_status: status, p_page: page });
  if (error) throw error;
  return z.object({ count: z.number(), rows: z.array(rowSchema) }).parse(data);
}
export async function resolveProviderReview(review: ProviderReview, decision: "accept" | "keep") {
  const { error } = await supabase.rpc("stackmint_resolve_provider_review", {
    p_id: review.id, p_decision: decision, p_expected_version: review.current?.row_version,
    p_expected_balance: review.current?.current_balance,
  });
  if (error) throw error;
}
