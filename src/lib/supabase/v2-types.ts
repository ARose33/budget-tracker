// Additive proposal contracts. Keep the baseline generated shared-database types intact.
import type { Database as Baseline, Json } from "./types";
export type { Json } from "./types";
type ExtendTable<T extends { Row: object; Insert: object; Update: object }, Fields> =
  Omit<T, "Row" | "Insert" | "Update"> & {
    Row: T["Row"] & Fields;
    Insert: T["Insert"] & Partial<Fields>;
    Update: T["Update"] & Partial<Fields>;
  };
type Tables = Baseline["public"]["Tables"];
type RPC<Args> = { Args: Args; Returns: Json };
export type Database = Omit<Baseline, "public"> & {
  public: Omit<Baseline["public"], "Tables" | "Functions"> & {
    Tables: Omit<Tables, "transactions" | "budgets" | "bank_connections"> & {
      transaction_note_versions: {
        Row: { user_id: string; transaction_id: string; version: number; content: string; created_at: string };
        Insert: { user_id: string; transaction_id: string; version: number; content: string; created_at?: string };
        Update: never;
        Relationships: [];
      };
      transactions: ExtendTable<Tables["transactions"], {
        row_version: number; archived_at: string | null; manual_override_fields: string[] | null;
        provider_pending_transaction_id: string | null;
      }>;
      budgets: ExtendTable<Tables["budgets"], { row_version: number }>;
      bank_connections: ExtendTable<Tables["bank_connections"], {
        sync_lock_token: string | null; sync_lock_until: string | null; sync_generation: number;
      }>;
    };
    Functions: Baseline["public"]["Functions"] & {
      stackmint_budget: RPC<{ p_year: number; p_month: number }>;
      stackmint_budget_activity: RPC<{ p_year: number; p_month: number; p_category_id?: string; p_filter?: string; p_offset?: number; p_limit?: number }>;
      stackmint_analysis: RPC<{ p_from: string; p_to: string }>;
      stackmint_transactions: RPC<{ p_filters?: Json; p_page?: number; p_size?: number; p_sort?: string; p_desc?: boolean }>;
      stackmint_save_budgets: RPC<{ p_edits: Json }>;
      stackmint_edit_transactions: RPC<{ p_items: Json; p_patch: Json }>;
      stackmint_save_split: RPC<{ p_parent_id: string; p_expected_version: number; p_allocations: Json }>;
      stackmint_unsplit: RPC<{ p_parent_id: string; p_expected_version: number }>;
      stackmint_category: { Args: { p_command: Json }; Returns: string };
      stackmint_write_note: { Args: { p_user_id: string; p_transaction_id: string; p_expected_version: number; p_legacy_content: string; p_content: string }; Returns: number };
    };
  };
};
