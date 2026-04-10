import { supabase } from "@/lib/supabase/client";

export interface Category {
  id: string;
  group_name: string;
  line_item_name: string;
  category_type: string | null;
}

export async function getCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from("budget_categories")
    .select("id, group_name, line_item_name, category_type")
    .order("group_name")
    .order("line_item_name");

  if (error) throw error;
  return data ?? [];
}

export function groupCategories(categories: Category[]) {
  const groups = new Map<string, Category[]>();
  for (const cat of categories) {
    if (!groups.has(cat.group_name)) {
      groups.set(cat.group_name, []);
    }
    groups.get(cat.group_name)!.push(cat);
  }
  return groups;
}
