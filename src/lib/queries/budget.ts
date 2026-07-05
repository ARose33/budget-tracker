import { supabase } from "@/lib/supabase/client";
import { getCurrentUserId } from "@/lib/supabase/auth";

export interface BudgetLineItem {
  category_id: string;
  group_name: string;
  line_item_name: string;
  category_type: string;
  budget_limit: number;
  actual_spent: number;
  rollover: number;
  effective_budget: number;
}

export interface BudgetGroup {
  group_name: string;
  category_type: string;
  items: BudgetLineItem[];
  total_budget: number;
  total_spent: number;
  total_rollover: number;
  total_effective: number;
}

export type BudgetCategoryType = "Income" | "Expense";

interface CategoryInput {
  groupName: string;
  lineItemName: string;
  categoryType: BudgetCategoryType;
  year: number;
  month: number;
  budgetLimit: number;
}

interface UpdateItemInput {
  categoryId: string;
  groupName: string;
  categoryType: string;
  lineItemName: string;
  year: number;
  month: number;
  budgetLimit: number;
}

interface RenameGroupInput {
  currentGroupName: string;
  categoryType: string;
  newGroupName: string;
}

function normalizeBudgetName(value: string, fieldName: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} is required`);
  }
  return trimmed;
}

function normalizeBudgetLimit(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Budget amount must be zero or greater");
  }
  return value;
}

function isSameOrFutureMonth(
  row: { year_number: number; month_number: number },
  year: number,
  month: number
) {
  return row.year_number > year || (row.year_number === year && row.month_number >= month);
}

async function ensureLineItemNameAvailable({
  userId,
  groupName,
  lineItemName,
  categoryType,
  excludeCategoryId,
}: {
  userId: string;
  groupName: string;
  lineItemName: string;
  categoryType: string;
  excludeCategoryId?: string;
}) {
  const { data, error } = await supabase
    .from("budget_categories")
    .select("id, line_item_name")
    .eq("user_id", userId)
    .eq("group_name", groupName)
    .eq("category_type", categoryType);

  if (error) throw error;

  const duplicate = (data ?? []).find(
    (category) =>
      category.id !== excludeCategoryId &&
      category.line_item_name.trim().toLocaleLowerCase() ===
        lineItemName.toLocaleLowerCase()
  );

  if (duplicate) {
    throw new Error("A subcategory with that name already exists in this category");
  }
}

async function getBudgetMonthsFromSelected(userId: string, year: number, month: number) {
  const { data, error } = await supabase
    .from("budgets")
    .select("year_number, month_number")
    .eq("user_id", userId)
    .or(`year_number.gt.${year},and(year_number.eq.${year},month_number.gte.${month})`);

  if (error) throw error;

  const monthMap = new Map<string, { year_number: number; month_number: number }>();
  for (const row of data ?? []) {
    if (!isSameOrFutureMonth(row, year, month)) continue;
    monthMap.set(`${row.year_number}-${row.month_number}`, row);
  }

  monthMap.set(`${year}-${month}`, { year_number: year, month_number: month });

  return Array.from(monthMap.values()).sort((a, b) => {
    if (a.year_number !== b.year_number) return a.year_number - b.year_number;
    return a.month_number - b.month_number;
  });
}

async function ensureBudgetRowsForCategory(
  userId: string,
  categoryId: string,
  year: number,
  month: number,
  budgetLimit: number
) {
  const futureMonths = await getBudgetMonthsFromSelected(userId, year, month);
  const { data: existingRows, error } = await supabase
    .from("budgets")
    .select("year_number, month_number")
    .eq("user_id", userId)
    .eq("category_id", categoryId)
    .or(`year_number.gt.${year},and(year_number.eq.${year},month_number.gte.${month})`);

  if (error) throw error;

  const existingKeys = new Set(
    (existingRows ?? []).map((row) => `${row.year_number}-${row.month_number}`)
  );
  const missingRows = futureMonths
    .filter((row) => !existingKeys.has(`${row.year_number}-${row.month_number}`))
    .map((row) => ({
      category_id: categoryId,
      year_number: row.year_number,
      month_number: row.month_number,
      budget_limit: budgetLimit,
      user_id: userId,
    }));

  if (missingRows.length === 0) return;

  const { error: insertError } = await supabase.from("budgets").insert(missingRows);
  if (insertError) throw insertError;
}

export async function getBudgetWithRollover(
  year: number,
  month: number
): Promise<BudgetLineItem[]> {
  const { data, error } = await supabase.rpc("get_budget_with_rollover", {
    p_year: year,
    p_month: month,
  });

  if (error) throw error;
  return (data as BudgetLineItem[]) ?? [];
}

export function groupBudgetItems(items: BudgetLineItem[]): BudgetGroup[] {
  const groups = new Map<string, BudgetGroup>();

  for (const item of items) {
    const key = `${item.category_type}::${item.group_name}`;
    if (!groups.has(key)) {
      groups.set(key, {
        group_name: item.group_name,
        category_type: item.category_type,
        items: [],
        total_budget: 0,
        total_spent: 0,
        total_rollover: 0,
        total_effective: 0,
      });
    }
    const group = groups.get(key)!;
    group.items.push(item);
    group.total_budget += Number(item.budget_limit);
    group.total_spent += Number(item.actual_spent);
    group.total_rollover += Number(item.rollover);
    group.total_effective += Number(item.effective_budget);
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      items: group.items.sort((a, b) =>
        a.line_item_name.localeCompare(b.line_item_name)
      ),
    }))
    .sort((a, b) => {
      const budgetCompare = b.total_effective - a.total_effective;
      if (budgetCompare !== 0) return budgetCompare;
      return a.group_name.localeCompare(b.group_name);
    });
}

export async function ensureBudgetRows(year: number, month: number) {
  const userId = await getCurrentUserId();
  // Check if budget rows exist for this month
  const { count } = await supabase
    .from("budgets")
    .select("*", { count: "exact", head: true })
    .eq("year_number", year)
    .eq("month_number", month)
    .eq("user_id", userId);

  if (count && count > 0) return;

  // Find the latest month with budget data
  const { data: latest } = await supabase
    .from("budgets")
    .select("year_number, month_number")
    .eq("user_id", userId)
    .order("year_number", { ascending: false })
    .order("month_number", { ascending: false })
    .limit(1);

  if (!latest || latest.length === 0) return;

  const lastYear = latest[0].year_number;
  const lastMonth = latest[0].month_number;

  // Copy budget rows from the latest month
  const { data: templates } = await supabase
    .from("budgets")
    .select("category_id, budget_limit, user_id")
    .eq("year_number", lastYear)
    .eq("month_number", lastMonth)
    .eq("user_id", userId);

  if (!templates || templates.length === 0) return;

  const newRows = templates.map((t) => ({
    category_id: t.category_id,
    year_number: year,
    month_number: month,
    budget_limit: t.budget_limit,
    user_id: t.user_id,
  }));

  await supabase.from("budgets").insert(newRows);
}

export async function updateBudgetLimit(
  categoryId: string,
  year: number,
  month: number,
  newLimit: number
) {
  const userId = await getCurrentUserId();
  const { error } = await supabase
    .from("budgets")
    .update({ budget_limit: newLimit })
    .eq("category_id", categoryId)
    .eq("year_number", year)
    .eq("month_number", month)
    .eq("user_id", userId);

  if (error) throw error;
}

export async function createBudgetCategory({
  groupName,
  lineItemName,
  categoryType,
  year,
  month,
  budgetLimit,
}: CategoryInput) {
  const userId = await getCurrentUserId();
  const normalizedGroupName = normalizeBudgetName(groupName, "Category name");
  const normalizedLineItemName = normalizeBudgetName(lineItemName, "Subcategory name");
  const normalizedBudgetLimit = normalizeBudgetLimit(budgetLimit);

  await ensureLineItemNameAvailable({
    userId,
    groupName: normalizedGroupName,
    lineItemName: normalizedLineItemName,
    categoryType,
  });

  const { data, error } = await supabase
    .from("budget_categories")
    .insert({
      group_name: normalizedGroupName,
      line_item_name: normalizedLineItemName,
      category_type: categoryType,
      user_id: userId,
    })
    .select("id")
    .single();

  if (error) throw error;

  await ensureBudgetRowsForCategory(
    userId,
    data.id,
    year,
    month,
    normalizedBudgetLimit
  );
}

export async function updateBudgetLineItem({
  categoryId,
  groupName,
  categoryType,
  lineItemName,
  year,
  month,
  budgetLimit,
}: UpdateItemInput) {
  const userId = await getCurrentUserId();
  const normalizedLineItemName = normalizeBudgetName(lineItemName, "Subcategory name");
  const normalizedBudgetLimit = normalizeBudgetLimit(budgetLimit);

  await ensureLineItemNameAvailable({
    userId,
    groupName,
    lineItemName: normalizedLineItemName,
    categoryType,
    excludeCategoryId: categoryId,
  });

  const { error: categoryError } = await supabase
    .from("budget_categories")
    .update({ line_item_name: normalizedLineItemName })
    .eq("id", categoryId)
    .eq("user_id", userId);

  if (categoryError) throw categoryError;

  await ensureBudgetRowsForCategory(
    userId,
    categoryId,
    year,
    month,
    normalizedBudgetLimit
  );

  const { error: budgetError } = await supabase
    .from("budgets")
    .update({ budget_limit: normalizedBudgetLimit })
    .eq("category_id", categoryId)
    .eq("user_id", userId)
    .or(`year_number.gt.${year},and(year_number.eq.${year},month_number.gte.${month})`);

  if (budgetError) throw budgetError;
}

export async function renameBudgetGroup({
  currentGroupName,
  categoryType,
  newGroupName,
}: RenameGroupInput) {
  const userId = await getCurrentUserId();
  const normalizedGroupName = normalizeBudgetName(newGroupName, "Category name");

  if (normalizedGroupName === currentGroupName) return;

  const { data: sourceCategories, error: sourceError } = await supabase
    .from("budget_categories")
    .select("id, line_item_name")
    .eq("user_id", userId)
    .eq("group_name", currentGroupName)
    .eq("category_type", categoryType);

  if (sourceError) throw sourceError;

  const { data: targetCategories, error: targetError } = await supabase
    .from("budget_categories")
    .select("id, line_item_name")
    .eq("user_id", userId)
    .eq("group_name", normalizedGroupName)
    .eq("category_type", categoryType);

  if (targetError) throw targetError;

  const sourceIds = new Set((sourceCategories ?? []).map((category) => category.id));
  const targetNames = new Set(
    (targetCategories ?? [])
      .filter((category) => !sourceIds.has(category.id))
      .map((category) => category.line_item_name.trim().toLocaleLowerCase())
  );
  const duplicate = (sourceCategories ?? []).some((category) =>
    targetNames.has(category.line_item_name.trim().toLocaleLowerCase())
  );

  if (duplicate) {
    throw new Error("That category already has a matching subcategory name");
  }

  const { error } = await supabase
    .from("budget_categories")
    .update({ group_name: normalizedGroupName })
    .eq("user_id", userId)
    .eq("group_name", currentGroupName)
    .eq("category_type", categoryType);

  if (error) throw error;
}
