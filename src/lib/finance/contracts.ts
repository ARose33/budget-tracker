import { z } from "zod";
const amount = z.number().finite();
export const budgetItemSchema = z.object({
  category_id: z.string().uuid(),
  group_name: z.string(),
  line_item_name: z.string(),
  category_type: z.string(),
  budget_id: z.string().uuid().nullable(),
  row_version: z.number().nullable(),
  has_budget: z.boolean(),
  budget_limit: amount,
  actual_spent: amount,
  pending_spent: amount,
  rollover: amount,
  effective_budget: amount,
  transaction_count: z.number(),
  review_count: z.number(),
});
export const budgetSchema = z.object({
  items: z.array(budgetItemSchema),
  attention: z.object({
    uncategorized_count: z.number(),
    uncategorized_outflow: amount,
    uncategorized_inflow: amount,
    pending_count: z.number(),
    pending_expenses: amount,
    pending_income: amount,
    review_count: z.number(),
    transfer_count: z.number(),
  }),
  months: z.array(z.object({ year: z.number(), month: z.number() })),
});
export const activitySchema = z.object({
  count: z.number(),
  total: amount,
  outflow: amount,
  inflow: amount,
  rows: z.array(
    z.object({
      id: z.string(),
      parent_transaction_id: z.string(),
      date: z.string(),
      description: z.string().nullable(),
      amount,
      parent_amount: amount,
      contribution: amount,
      category_id: z.string().nullable(),
      account_name: z.string(),
      categorization_status: z.string(),
      is_pending: z.boolean(),
      allocation: z.boolean(),
      row_version: z.number(),
      allocation_version: z.number(),
    }),
  ),
});
const flow = z.object({
  year_num: z.number(),
  month_num: z.number(),
  income: amount,
  expenses: amount,
  net: amount,
});
export const analysisSchema = z.object({
  groups: z.array(
    z.object({
      year_num: z.number(),
      month_num: z.number(),
      group_name: z.string(),
      total: amount,
    }),
  ),
  categories: z.array(
    z.object({
      year_num: z.number(),
      month_num: z.number(),
      category_id: z.string(),
      group_name: z.string(),
      line_item_name: z.string(),
      category_type: z.string(),
      total: amount,
    }),
  ),
  flow: z.array(flow),
  movements: z.array(flow),
});
export type BudgetLineItem = z.infer<typeof budgetItemSchema>;
export type BudgetWorkspace = z.infer<typeof budgetSchema>;
export type BudgetActivity = z.infer<typeof activitySchema>;
export type ActivityFilter =
  "booked" | "pending" | "uncategorized" | "review" | "all";
