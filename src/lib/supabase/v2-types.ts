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
    Tables: Omit<Tables, "transactions" | "budgets" | "bank_connections" | "accounts"> & {
      accounts: ExtendTable<Tables["accounts"], { bank_balance_managed: boolean }>;
      sync_receipts: {
        Row: { operation_id: string; user_id: string; connection_id: string; result: Json; created_at: string };
        Insert: never; Update: never; Relationships: [];
      };
      transaction_note_versions: {
        Row: { user_id: string; transaction_id: string; version: number; content: string; created_at: string };
        Insert: { user_id: string; transaction_id: string; version: number; content: string; created_at?: string };
        Update: never;
        Relationships: [];
      };
      transactions: ExtendTable<Tables["transactions"], {
        row_version: number; archived_at: string | null; manual_override_fields: string[] | null;
        provider_pending_transaction_id: string | null;
        provider_snapshot: Json | null;
      }>;
      budgets: ExtendTable<Tables["budgets"], { row_version: number }>;
      bank_connections: ExtendTable<Tables["bank_connections"], {
        sync_lock_token: string | null; sync_lock_until: string | null; sync_generation: number;
      }>;
    };
    Functions: Baseline["public"]["Functions"] & {
      stackmint_categorization_counts: RPC<Record<string, never>>;
      stackmint_transaction_history: RPC<{ p_id: string; p_kind?: string; p_page?: number }>;
      stackmint_legacy_connections: RPC<Record<string, never>>;
      stackmint_reconciliation: RPC<{ p_filters?: Json; p_summary_only?: boolean }>;
      stackmint_resolve_reconciliation: RPC<{ p_id: string; p_version: number; p_decision: string; p_candidate_id?: string | null; p_candidate_version?: number | null; p_note?: string | null }>;
      stackmint_begin_categorization: RPC<{ p_id: string; p_token: string }>;
      stackmint_finish_categorization: RPC<{ p_id: string; p_token: string; p_items?: Json }>;
      stackmint_categorization_matches: RPC<{ p_ids: string[] }>;
      stackmint_budget: RPC<{ p_year: number; p_month: number }>;
      stackmint_budget_activity: RPC<{ p_year: number; p_month: number; p_category_id?: string; p_filter?: string; p_offset?: number; p_limit?: number }>;
      stackmint_analysis: RPC<{ p_from: string; p_to: string }>;
      stackmint_transactions: RPC<{ p_filters?: Json; p_page?: number; p_size?: number; p_sort?: string; p_desc?: boolean }>;
      stackmint_acquire_sync: RPC<{ p_connection_id: string; p_token: string }>;
      stackmint_provider_reviews: RPC<{ p_status?: string; p_page?: number }>;
      stackmint_resolve_provider_review: { Args: { p_id: string; p_decision: string; p_expected_version?: number | null; p_expected_balance?: number | null }; Returns: undefined };
      stackmint_begin_disconnect: { Args: { p_connection_id: string; p_user_id: string }; Returns: boolean };
      stackmint_release_sync: { Args: { p_connection_id: string; p_token: string; p_error?: string }; Returns: undefined };
      stackmint_apply_sync: RPC<{ p_connection_id: string; p_token: string; p_generation: number; p_base_cursor: string | null; p_next_cursor: string; p_accounts: Json; p_transactions: Json; p_removed: Json }>;
      stackmint_save_budgets: RPC<{ p_edits: Json }>;
      stackmint_edit_transactions: RPC<{ p_items: Json; p_patch: Json }>;
      stackmint_save_split: RPC<{ p_parent_id: string; p_expected_version: number; p_allocations: Json }>;
      stackmint_unsplit: RPC<{ p_parent_id: string; p_expected_version: number }>;
      stackmint_category: { Args: { p_command: Json }; Returns: string };
      stackmint_write_note: { Args: { p_user_id: string; p_transaction_id: string; p_expected_version: number; p_legacy_content: string; p_content: string }; Returns: number };
    };
  };
};
