export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          current_balance: number | null
          id: string
          initial_date: string | null
          initial_value: number | null
          institution: string
          last_synced_at: string | null
          name: string
          plaid_account_id: string | null
          type: string | null
          user_id: string | null
        }
        Insert: {
          current_balance?: number | null
          id?: string
          initial_date?: string | null
          initial_value?: number | null
          institution: string
          last_synced_at?: string | null
          name: string
          plaid_account_id?: string | null
          type?: string | null
          user_id?: string | null
        }
        Update: {
          current_balance?: number | null
          id?: string
          initial_date?: string | null
          initial_value?: number | null
          institution?: string
          last_synced_at?: string | null
          name?: string
          plaid_account_id?: string | null
          type?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      budget_categories: {
        Row: {
          category_type: string | null
          group_name: string
          id: string
          line_item_name: string
          user_id: string | null
        }
        Insert: {
          category_type?: string | null
          group_name: string
          id?: string
          line_item_name: string
          user_id?: string | null
        }
        Update: {
          category_type?: string | null
          group_name?: string
          id?: string
          line_item_name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      budgets: {
        Row: {
          budget_limit: number | null
          category_id: string | null
          id: string
          month_number: number
          user_id: string
          year_number: number
        }
        Insert: {
          budget_limit?: number | null
          category_id?: string | null
          id?: string
          month_number: number
          user_id?: string
          year_number: number
        }
        Update: {
          budget_limit?: number | null
          category_id?: string | null
          id?: string
          month_number?: number
          user_id?: string
          year_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "budgets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "budget_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      mb_budgets: {
        Row: {
          category: string
          monthly_amount: number
          updated_at: string | null
        }
        Insert: {
          category: string
          monthly_amount: number
          updated_at?: string | null
        }
        Update: {
          category?: string
          monthly_amount?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      mf_activity: {
        Row: {
          activity_type: string
          created_at: string | null
          created_by: string | null
          description: string
          id: string
          metadata: Json | null
          property_id: string | null
        }
        Insert: {
          activity_type: string
          created_at?: string | null
          created_by?: string | null
          description: string
          id?: string
          metadata?: Json | null
          property_id?: string | null
        }
        Update: {
          activity_type?: string
          created_at?: string | null
          created_by?: string | null
          description?: string
          id?: string
          metadata?: Json | null
          property_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mf_activity_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "mf_properties"
            referencedColumns: ["id"]
          },
        ]
      }
      mf_loopnet_watch: {
        Row: {
          address: string | null
          asking_price: number | null
          cap_rate: number | null
          city: string | null
          created_at: string | null
          id: string
          imported: boolean | null
          last_checked_at: string | null
          listing_date: string | null
          listing_status: string | null
          loopnet_id: string | null
          loopnet_url: string
          price_history: Json | null
          price_per_unit: number | null
          property_id: string | null
          state: string | null
          units: number | null
        }
        Insert: {
          address?: string | null
          asking_price?: number | null
          cap_rate?: number | null
          city?: string | null
          created_at?: string | null
          id?: string
          imported?: boolean | null
          last_checked_at?: string | null
          listing_date?: string | null
          listing_status?: string | null
          loopnet_id?: string | null
          loopnet_url: string
          price_history?: Json | null
          price_per_unit?: number | null
          property_id?: string | null
          state?: string | null
          units?: number | null
        }
        Update: {
          address?: string | null
          asking_price?: number | null
          cap_rate?: number | null
          city?: string | null
          created_at?: string | null
          id?: string
          imported?: boolean | null
          last_checked_at?: string | null
          listing_date?: string | null
          listing_status?: string | null
          loopnet_id?: string | null
          loopnet_url?: string
          price_history?: Json | null
          price_per_unit?: number | null
          property_id?: string | null
          state?: string | null
          units?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "mf_loopnet_watch_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "mf_properties"
            referencedColumns: ["id"]
          },
        ]
      }
      mf_properties: {
        Row: {
          additional_docs: Json | null
          address: string | null
          asking_price: number | null
          broker_company: string | null
          broker_email: string | null
          broker_name: string | null
          broker_phone: string | null
          cap_rate: number | null
          cap_rate_year2: number | null
          cash_on_cash: number | null
          city: string
          closing_costs: number | null
          created_at: string | null
          created_by: string | null
          day_one_capex: number | null
          down_payment: number | null
          down_payment_pct: number | null
          dscr: number | null
          effective_gross_income: number | null
          expenses: Json | null
          gross_income: number | null
          id: string
          investment_thesis: string | null
          levered_irr: number | null
          loan_amount: number | null
          loan_rate: number | null
          loan_term: number | null
          loopnet_id: string | null
          loopnet_url: string | null
          lot_size: string | null
          market: string | null
          monthly_payment: number | null
          monthly_rent_roll: number | null
          monthly_rent_year2: number | null
          name: string
          noi: number | null
          noi_year2: number | null
          notes: string | null
          npv: number | null
          offer_price: number | null
          om_url: string | null
          other_income: number | null
          price_per_unit: number | null
          pro_forma_file: string | null
          pro_forma_url: string | null
          property_class: string | null
          property_type: string | null
          purchase_price: number | null
          source: string | null
          sqft: number | null
          state: string
          status: string
          ten_year_equity: number | null
          terminal_value: number | null
          total_expenses: number | null
          unit_mix: string | null
          units: number | null
          unlevered_irr: number | null
          updated_at: string | null
          vacancy: number | null
          year_built: number | null
          zip: string | null
        }
        Insert: {
          additional_docs?: Json | null
          address?: string | null
          asking_price?: number | null
          broker_company?: string | null
          broker_email?: string | null
          broker_name?: string | null
          broker_phone?: string | null
          cap_rate?: number | null
          cap_rate_year2?: number | null
          cash_on_cash?: number | null
          city: string
          closing_costs?: number | null
          created_at?: string | null
          created_by?: string | null
          day_one_capex?: number | null
          down_payment?: number | null
          down_payment_pct?: number | null
          dscr?: number | null
          effective_gross_income?: number | null
          expenses?: Json | null
          gross_income?: number | null
          id?: string
          investment_thesis?: string | null
          levered_irr?: number | null
          loan_amount?: number | null
          loan_rate?: number | null
          loan_term?: number | null
          loopnet_id?: string | null
          loopnet_url?: string | null
          lot_size?: string | null
          market?: string | null
          monthly_payment?: number | null
          monthly_rent_roll?: number | null
          monthly_rent_year2?: number | null
          name: string
          noi?: number | null
          noi_year2?: number | null
          notes?: string | null
          npv?: number | null
          offer_price?: number | null
          om_url?: string | null
          other_income?: number | null
          price_per_unit?: number | null
          pro_forma_file?: string | null
          pro_forma_url?: string | null
          property_class?: string | null
          property_type?: string | null
          purchase_price?: number | null
          source?: string | null
          sqft?: number | null
          state?: string
          status?: string
          ten_year_equity?: number | null
          terminal_value?: number | null
          total_expenses?: number | null
          unit_mix?: string | null
          units?: number | null
          unlevered_irr?: number | null
          updated_at?: string | null
          vacancy?: number | null
          year_built?: number | null
          zip?: string | null
        }
        Update: {
          additional_docs?: Json | null
          address?: string | null
          asking_price?: number | null
          broker_company?: string | null
          broker_email?: string | null
          broker_name?: string | null
          broker_phone?: string | null
          cap_rate?: number | null
          cap_rate_year2?: number | null
          cash_on_cash?: number | null
          city?: string
          closing_costs?: number | null
          created_at?: string | null
          created_by?: string | null
          day_one_capex?: number | null
          down_payment?: number | null
          down_payment_pct?: number | null
          dscr?: number | null
          effective_gross_income?: number | null
          expenses?: Json | null
          gross_income?: number | null
          id?: string
          investment_thesis?: string | null
          levered_irr?: number | null
          loan_amount?: number | null
          loan_rate?: number | null
          loan_term?: number | null
          loopnet_id?: string | null
          loopnet_url?: string | null
          lot_size?: string | null
          market?: string | null
          monthly_payment?: number | null
          monthly_rent_roll?: number | null
          monthly_rent_year2?: number | null
          name?: string
          noi?: number | null
          noi_year2?: number | null
          notes?: string | null
          npv?: number | null
          offer_price?: number | null
          om_url?: string | null
          other_income?: number | null
          price_per_unit?: number | null
          pro_forma_file?: string | null
          pro_forma_url?: string | null
          property_class?: string | null
          property_type?: string | null
          purchase_price?: number | null
          source?: string | null
          sqft?: number | null
          state?: string
          status?: string
          ten_year_equity?: number | null
          terminal_value?: number | null
          total_expenses?: number | null
          unit_mix?: string | null
          units?: number | null
          unlevered_irr?: number | null
          updated_at?: string | null
          vacancy?: number | null
          year_built?: number | null
          zip?: string | null
        }
        Relationships: []
      }
      mf_target_markets: {
        Row: {
          avg_cap_rate: number | null
          avg_price_per_unit: number | null
          city: string
          id: string
          job_growth_5yr: number | null
          landlord_friendly: boolean | null
          median_income: number | null
          metro: string | null
          notes: string | null
          population_growth_5yr: number | null
          rent_growth_yoy: number | null
          state: string
          tier: string | null
          updated_at: string | null
          vacancy_rate: number | null
        }
        Insert: {
          avg_cap_rate?: number | null
          avg_price_per_unit?: number | null
          city: string
          id?: string
          job_growth_5yr?: number | null
          landlord_friendly?: boolean | null
          median_income?: number | null
          metro?: string | null
          notes?: string | null
          population_growth_5yr?: number | null
          rent_growth_yoy?: number | null
          state: string
          tier?: string | null
          updated_at?: string | null
          vacancy_rate?: number | null
        }
        Update: {
          avg_cap_rate?: number | null
          avg_price_per_unit?: number | null
          city?: string
          id?: string
          job_growth_5yr?: number | null
          landlord_friendly?: boolean | null
          median_income?: number | null
          metro?: string | null
          notes?: string | null
          population_growth_5yr?: number | null
          rent_growth_yoy?: number | null
          state?: string
          tier?: string | null
          updated_at?: string | null
          vacancy_rate?: number | null
        }
        Relationships: []
      }
      plaid_items: {
        Row: {
          access_token: string
          created_at: string | null
          cursor: string | null
          id: string
          institution_name: string | null
          item_id: string | null
        }
        Insert: {
          access_token: string
          created_at?: string | null
          cursor?: string | null
          id?: string
          institution_name?: string | null
          item_id?: string | null
        }
        Update: {
          access_token?: string
          created_at?: string | null
          cursor?: string | null
          id?: string
          institution_name?: string | null
          item_id?: string | null
        }
        Relationships: []
      }
      rei_documents: {
        Row: {
          extracted_summary: string | null
          file_name: string
          id: string
          property_id: string
          storage_path: string | null
          upload_date: string
        }
        Insert: {
          extracted_summary?: string | null
          file_name: string
          id?: string
          property_id: string
          storage_path?: string | null
          upload_date?: string
        }
        Update: {
          extracted_summary?: string | null
          file_name?: string
          id?: string
          property_id?: string
          storage_path?: string | null
          upload_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "rei_documents_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "rei_properties"
            referencedColumns: ["id"]
          },
        ]
      }
      rei_market_comps: {
        Row: {
          annual_revenue: number | null
          comp_name: string | null
          date_pulled: string
          id: string
          monthly_rent: number | null
          nightly_rate: number | null
          occupancy_rate: number | null
          property_id: string
          source: string | null
        }
        Insert: {
          annual_revenue?: number | null
          comp_name?: string | null
          date_pulled?: string
          id?: string
          monthly_rent?: number | null
          nightly_rate?: number | null
          occupancy_rate?: number | null
          property_id: string
          source?: string | null
        }
        Update: {
          annual_revenue?: number | null
          comp_name?: string | null
          date_pulled?: string
          id?: string
          monthly_rent?: number | null
          nightly_rate?: number | null
          occupancy_rate?: number | null
          property_id?: string
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rei_market_comps_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "rei_properties"
            referencedColumns: ["id"]
          },
        ]
      }
      rei_mf_underwriting: {
        Row: {
          annual_capex_reserve: number | null
          annual_cash_flow: number | null
          annual_insurance: number | null
          annual_maintenance: number | null
          annual_other_expenses: number | null
          annual_property_tax: number | null
          avg_monthly_rent_per_unit: number | null
          cap_rate: number | null
          cash_on_cash_return: number | null
          created_at: string
          down_payment_pct: number | null
          dscr: number | null
          gross_rent_multiplier: number | null
          id: string
          interest_rate: number | null
          loan_term_years: number | null
          noi: number | null
          num_units: number | null
          price_per_unit: number | null
          projected_vacancy_rate: number | null
          property_id: string
          purchase_price: number | null
          rent_per_unit: number | null
          updated_at: string
        }
        Insert: {
          annual_capex_reserve?: number | null
          annual_cash_flow?: number | null
          annual_insurance?: number | null
          annual_maintenance?: number | null
          annual_other_expenses?: number | null
          annual_property_tax?: number | null
          avg_monthly_rent_per_unit?: number | null
          cap_rate?: number | null
          cash_on_cash_return?: number | null
          created_at?: string
          down_payment_pct?: number | null
          dscr?: number | null
          gross_rent_multiplier?: number | null
          id?: string
          interest_rate?: number | null
          loan_term_years?: number | null
          noi?: number | null
          num_units?: number | null
          price_per_unit?: number | null
          projected_vacancy_rate?: number | null
          property_id: string
          purchase_price?: number | null
          rent_per_unit?: number | null
          updated_at?: string
        }
        Update: {
          annual_capex_reserve?: number | null
          annual_cash_flow?: number | null
          annual_insurance?: number | null
          annual_maintenance?: number | null
          annual_other_expenses?: number | null
          annual_property_tax?: number | null
          avg_monthly_rent_per_unit?: number | null
          cap_rate?: number | null
          cash_on_cash_return?: number | null
          created_at?: string
          down_payment_pct?: number | null
          dscr?: number | null
          gross_rent_multiplier?: number | null
          id?: string
          interest_rate?: number | null
          loan_term_years?: number | null
          noi?: number | null
          num_units?: number | null
          price_per_unit?: number | null
          projected_vacancy_rate?: number | null
          property_id?: string
          purchase_price?: number | null
          rent_per_unit?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rei_mf_underwriting_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "rei_properties"
            referencedColumns: ["id"]
          },
        ]
      }
      rei_properties: {
        Row: {
          address: string
          asking_price: number | null
          city: string
          created_at: string
          id: string
          is_favorite: boolean
          listing_source: string | null
          listing_url: string | null
          notes: string | null
          property_type: string
          state: string
          status: string
          updated_at: string
          user_id: string
          zip: string | null
        }
        Insert: {
          address: string
          asking_price?: number | null
          city: string
          created_at?: string
          id?: string
          is_favorite?: boolean
          listing_source?: string | null
          listing_url?: string | null
          notes?: string | null
          property_type: string
          state: string
          status?: string
          updated_at?: string
          user_id?: string
          zip?: string | null
        }
        Update: {
          address?: string
          asking_price?: number | null
          city?: string
          created_at?: string
          id?: string
          is_favorite?: boolean
          listing_source?: string | null
          listing_url?: string | null
          notes?: string | null
          property_type?: string
          state?: string
          status?: string
          updated_at?: string
          user_id?: string
          zip?: string | null
        }
        Relationships: []
      }
      rei_scenarios: {
        Row: {
          computed_outputs: Json | null
          created_at: string
          id: string
          overrides: Json
          property_id: string
          scenario_name: string
          updated_at: string
        }
        Insert: {
          computed_outputs?: Json | null
          created_at?: string
          id?: string
          overrides?: Json
          property_id: string
          scenario_name: string
          updated_at?: string
        }
        Update: {
          computed_outputs?: Json | null
          created_at?: string
          id?: string
          overrides?: Json
          property_id?: string
          scenario_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rei_scenarios_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "rei_properties"
            referencedColumns: ["id"]
          },
        ]
      }
      rei_sf_underwriting: {
        Row: {
          annual_appreciation_rate: number | null
          annual_hoa: number | null
          annual_insurance: number | null
          annual_maintenance_reserve: number | null
          annual_property_tax: number | null
          closing_costs: number | null
          created_at: string
          down_payment_pct: number | null
          equity_year_10: number | null
          equity_year_20: number | null
          equity_year_5: number | null
          estimated_monthly_rent_equivalent: number | null
          id: string
          interest_rate: number | null
          loan_term_years: number | null
          monthly_mortgage_payment: number | null
          property_id: string
          purchase_price: number | null
          rent_vs_buy_breakeven_years: number | null
          total_cost_own_year_10: number | null
          total_cost_own_year_20: number | null
          total_cost_own_year_5: number | null
          total_cost_rent_year_10: number | null
          total_cost_rent_year_20: number | null
          total_cost_rent_year_5: number | null
          total_monthly_cost: number | null
          updated_at: string
        }
        Insert: {
          annual_appreciation_rate?: number | null
          annual_hoa?: number | null
          annual_insurance?: number | null
          annual_maintenance_reserve?: number | null
          annual_property_tax?: number | null
          closing_costs?: number | null
          created_at?: string
          down_payment_pct?: number | null
          equity_year_10?: number | null
          equity_year_20?: number | null
          equity_year_5?: number | null
          estimated_monthly_rent_equivalent?: number | null
          id?: string
          interest_rate?: number | null
          loan_term_years?: number | null
          monthly_mortgage_payment?: number | null
          property_id: string
          purchase_price?: number | null
          rent_vs_buy_breakeven_years?: number | null
          total_cost_own_year_10?: number | null
          total_cost_own_year_20?: number | null
          total_cost_own_year_5?: number | null
          total_cost_rent_year_10?: number | null
          total_cost_rent_year_20?: number | null
          total_cost_rent_year_5?: number | null
          total_monthly_cost?: number | null
          updated_at?: string
        }
        Update: {
          annual_appreciation_rate?: number | null
          annual_hoa?: number | null
          annual_insurance?: number | null
          annual_maintenance_reserve?: number | null
          annual_property_tax?: number | null
          closing_costs?: number | null
          created_at?: string
          down_payment_pct?: number | null
          equity_year_10?: number | null
          equity_year_20?: number | null
          equity_year_5?: number | null
          estimated_monthly_rent_equivalent?: number | null
          id?: string
          interest_rate?: number | null
          loan_term_years?: number | null
          monthly_mortgage_payment?: number | null
          property_id?: string
          purchase_price?: number | null
          rent_vs_buy_breakeven_years?: number | null
          total_cost_own_year_10?: number | null
          total_cost_own_year_20?: number | null
          total_cost_own_year_5?: number | null
          total_cost_rent_year_10?: number | null
          total_cost_rent_year_20?: number | null
          total_cost_rent_year_5?: number | null
          total_monthly_cost?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rei_sf_underwriting_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "rei_properties"
            referencedColumns: ["id"]
          },
        ]
      }
      rei_str_underwriting: {
        Row: {
          annual_cash_flow: number | null
          annual_hoa: number | null
          annual_insurance: number | null
          annual_maintenance_reserve: number | null
          annual_platform_fees: number | null
          annual_property_tax: number | null
          breakeven_occupancy_rate: number | null
          cap_rate: number | null
          cash_on_cash_return: number | null
          closing_costs: number | null
          created_at: string
          down_payment_pct: number | null
          gross_yield: number | null
          id: string
          interest_rate: number | null
          loan_term_years: number | null
          monthly_mortgage_payment: number | null
          noi: number | null
          projected_annual_gross_revenue: number | null
          projected_nightly_rate: number | null
          projected_occupancy_rate: number | null
          property_id: string
          purchase_price: number | null
          updated_at: string
        }
        Insert: {
          annual_cash_flow?: number | null
          annual_hoa?: number | null
          annual_insurance?: number | null
          annual_maintenance_reserve?: number | null
          annual_platform_fees?: number | null
          annual_property_tax?: number | null
          breakeven_occupancy_rate?: number | null
          cap_rate?: number | null
          cash_on_cash_return?: number | null
          closing_costs?: number | null
          created_at?: string
          down_payment_pct?: number | null
          gross_yield?: number | null
          id?: string
          interest_rate?: number | null
          loan_term_years?: number | null
          monthly_mortgage_payment?: number | null
          noi?: number | null
          projected_annual_gross_revenue?: number | null
          projected_nightly_rate?: number | null
          projected_occupancy_rate?: number | null
          property_id: string
          purchase_price?: number | null
          updated_at?: string
        }
        Update: {
          annual_cash_flow?: number | null
          annual_hoa?: number | null
          annual_insurance?: number | null
          annual_maintenance_reserve?: number | null
          annual_platform_fees?: number | null
          annual_property_tax?: number | null
          breakeven_occupancy_rate?: number | null
          cap_rate?: number | null
          cash_on_cash_return?: number | null
          closing_costs?: number | null
          created_at?: string
          down_payment_pct?: number | null
          gross_yield?: number | null
          id?: string
          interest_rate?: number | null
          loan_term_years?: number | null
          monthly_mortgage_payment?: number | null
          noi?: number | null
          projected_annual_gross_revenue?: number | null
          projected_nightly_rate?: number | null
          projected_occupancy_rate?: number | null
          property_id?: string
          purchase_price?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rei_str_underwriting_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "rei_properties"
            referencedColumns: ["id"]
          },
        ]
      }
      str_activity: {
        Row: {
          activity_type: string
          created_at: string | null
          created_by: string | null
          description: string
          id: string
          metadata: Json | null
          property_id: string | null
        }
        Insert: {
          activity_type: string
          created_at?: string | null
          created_by?: string | null
          description: string
          id?: string
          metadata?: Json | null
          property_id?: string | null
        }
        Update: {
          activity_type?: string
          created_at?: string | null
          created_by?: string | null
          description?: string
          id?: string
          metadata?: Json | null
          property_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "str_activity_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "str_properties"
            referencedColumns: ["id"]
          },
        ]
      }
      str_markets: {
        Row: {
          avg_adr: number | null
          avg_annual_revenue: number | null
          avg_occupancy: number | null
          id: string
          license_cap: string | null
          location: string
          notes: string | null
          permit_cost: string | null
          regulation_detail: string | null
          regulation_status: string
          state: string
          updated_at: string | null
        }
        Insert: {
          avg_adr?: number | null
          avg_annual_revenue?: number | null
          avg_occupancy?: number | null
          id?: string
          license_cap?: string | null
          location: string
          notes?: string | null
          permit_cost?: string | null
          regulation_detail?: string | null
          regulation_status?: string
          state?: string
          updated_at?: string | null
        }
        Update: {
          avg_adr?: number | null
          avg_annual_revenue?: number | null
          avg_occupancy?: number | null
          id?: string
          license_cap?: string | null
          location?: string
          notes?: string | null
          permit_cost?: string | null
          regulation_detail?: string | null
          regulation_status?: string
          state?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      str_properties: {
        Row: {
          address: string | null
          annual_data: Json | null
          annual_revenue: number | null
          avg_nightly_rate: number | null
          avg_occupancy: number | null
          baths: number | null
          beds: number | null
          buy_box_score: number | null
          cap_rate: number | null
          cash_on_cash: number | null
          closing_costs: number | null
          condition: string | null
          created_at: string | null
          created_by: string | null
          day_one_capex: number | null
          down_payment: number | null
          down_payment_pct: number | null
          dscr: number | null
          expenses: Json | null
          has_garage: boolean | null
          has_land: boolean | null
          has_outdoor_space: boolean | null
          has_views: boolean | null
          id: string
          levered_irr: number | null
          loan_amount: number | null
          loan_rate: number | null
          loan_term: number | null
          location: string
          lot_size: string | null
          market_id: string | null
          monthly_payment: number | null
          monthly_revenue: Json | null
          name: string
          noi: number | null
          notes: string | null
          npv: number | null
          price_to_revenue_ratio: number | null
          property_type: string | null
          purchase_price: number | null
          source: string | null
          source_file: string | null
          sqft: number | null
          status: string
          ten_year_equity: number | null
          updated_at: string | null
          year_built: number | null
          zillow_id: string | null
          zillow_url: string | null
        }
        Insert: {
          address?: string | null
          annual_data?: Json | null
          annual_revenue?: number | null
          avg_nightly_rate?: number | null
          avg_occupancy?: number | null
          baths?: number | null
          beds?: number | null
          buy_box_score?: number | null
          cap_rate?: number | null
          cash_on_cash?: number | null
          closing_costs?: number | null
          condition?: string | null
          created_at?: string | null
          created_by?: string | null
          day_one_capex?: number | null
          down_payment?: number | null
          down_payment_pct?: number | null
          dscr?: number | null
          expenses?: Json | null
          has_garage?: boolean | null
          has_land?: boolean | null
          has_outdoor_space?: boolean | null
          has_views?: boolean | null
          id?: string
          levered_irr?: number | null
          loan_amount?: number | null
          loan_rate?: number | null
          loan_term?: number | null
          location: string
          lot_size?: string | null
          market_id?: string | null
          monthly_payment?: number | null
          monthly_revenue?: Json | null
          name: string
          noi?: number | null
          notes?: string | null
          npv?: number | null
          price_to_revenue_ratio?: number | null
          property_type?: string | null
          purchase_price?: number | null
          source?: string | null
          source_file?: string | null
          sqft?: number | null
          status?: string
          ten_year_equity?: number | null
          updated_at?: string | null
          year_built?: number | null
          zillow_id?: string | null
          zillow_url?: string | null
        }
        Update: {
          address?: string | null
          annual_data?: Json | null
          annual_revenue?: number | null
          avg_nightly_rate?: number | null
          avg_occupancy?: number | null
          baths?: number | null
          beds?: number | null
          buy_box_score?: number | null
          cap_rate?: number | null
          cash_on_cash?: number | null
          closing_costs?: number | null
          condition?: string | null
          created_at?: string | null
          created_by?: string | null
          day_one_capex?: number | null
          down_payment?: number | null
          down_payment_pct?: number | null
          dscr?: number | null
          expenses?: Json | null
          has_garage?: boolean | null
          has_land?: boolean | null
          has_outdoor_space?: boolean | null
          has_views?: boolean | null
          id?: string
          levered_irr?: number | null
          loan_amount?: number | null
          loan_rate?: number | null
          loan_term?: number | null
          location?: string
          lot_size?: string | null
          market_id?: string | null
          monthly_payment?: number | null
          monthly_revenue?: Json | null
          name?: string
          noi?: number | null
          notes?: string | null
          npv?: number | null
          price_to_revenue_ratio?: number | null
          property_type?: string | null
          purchase_price?: number | null
          source?: string | null
          source_file?: string | null
          sqft?: number | null
          status?: string
          ten_year_equity?: number | null
          updated_at?: string | null
          year_built?: number | null
          zillow_id?: string | null
          zillow_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "str_properties_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "str_markets"
            referencedColumns: ["id"]
          },
        ]
      }
      str_zillow_watch: {
        Row: {
          address: string | null
          baths: number | null
          beds: number | null
          created_at: string | null
          id: string
          imported: boolean | null
          last_checked_at: string | null
          listing_status: string | null
          location: string | null
          price: number | null
          price_history: Json | null
          property_id: string | null
          sqft: number | null
          zillow_id: string | null
          zillow_url: string
        }
        Insert: {
          address?: string | null
          baths?: number | null
          beds?: number | null
          created_at?: string | null
          id?: string
          imported?: boolean | null
          last_checked_at?: string | null
          listing_status?: string | null
          location?: string | null
          price?: number | null
          price_history?: Json | null
          property_id?: string | null
          sqft?: number | null
          zillow_id?: string | null
          zillow_url: string
        }
        Update: {
          address?: string | null
          baths?: number | null
          beds?: number | null
          created_at?: string | null
          id?: string
          imported?: boolean | null
          last_checked_at?: string | null
          listing_status?: string | null
          location?: string | null
          price?: number | null
          price_history?: Json | null
          property_id?: string | null
          sqft?: number | null
          zillow_id?: string | null
          zillow_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "str_zillow_watch_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "str_properties"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          account: string | null
          account_id: string | null
          amount: number
          category: string | null
          category_id: string | null
          created_at: string | null
          date: string
          description: string | null
          id: string
          is_split: boolean | null
          parent_id: string | null
          plaid_transaction_id: string | null
          source: string | null
          status: string | null
          upload_source: string | null
          user_id: string
        }
        Insert: {
          account?: string | null
          account_id?: string | null
          amount: number
          category?: string | null
          category_id?: string | null
          created_at?: string | null
          date: string
          description?: string | null
          id?: string
          is_split?: boolean | null
          parent_id?: string | null
          plaid_transaction_id?: string | null
          source?: string | null
          status?: string | null
          upload_source?: string | null
          user_id?: string
        }
        Update: {
          account?: string | null
          account_id?: string | null
          amount?: number
          category?: string | null
          category_id?: string | null
          created_at?: string | null
          date?: string
          description?: string | null
          id?: string
          is_split?: boolean | null
          parent_id?: string | null
          plaid_transaction_id?: string | null
          source?: string | null
          status?: string | null
          upload_source?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "budget_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "monthly_category_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      wm_accounts: {
        Row: {
          account_name: string
          account_type: string
          alert_sender_email: string | null
          alert_subject_keywords: string | null
          created_at: string | null
          id: string
          institution_name: string
          investment_strategy: string | null
          is_active: boolean
          is_asset: boolean
          last_four_digits: string | null
          notes: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          account_name: string
          account_type: string
          alert_sender_email?: string | null
          alert_subject_keywords?: string | null
          created_at?: string | null
          id?: string
          institution_name: string
          investment_strategy?: string | null
          is_active?: boolean
          is_asset: boolean
          last_four_digits?: string | null
          notes?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Update: {
          account_name?: string
          account_type?: string
          alert_sender_email?: string | null
          alert_subject_keywords?: string | null
          created_at?: string | null
          id?: string
          institution_name?: string
          investment_strategy?: string | null
          is_active?: boolean
          is_asset?: boolean
          last_four_digits?: string | null
          notes?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      wm_balance_snapshots: {
        Row: {
          account_id: string
          closing_balance: number
          created_at: string | null
          id: string
          opening_balance: number
          snapshot_date: string
          source: string
          user_id: string
        }
        Insert: {
          account_id: string
          closing_balance: number
          created_at?: string | null
          id?: string
          opening_balance: number
          snapshot_date: string
          source?: string
          user_id?: string
        }
        Update: {
          account_id?: string
          closing_balance?: number
          created_at?: string | null
          id?: string
          opening_balance?: number
          snapshot_date?: string
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wm_balance_snapshots_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "wm_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      wm_net_worth_snapshots: {
        Row: {
          created_at: string | null
          id: string
          net_worth: number
          snapshot_date: string
          total_assets: number
          total_liabilities: number
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          net_worth: number
          snapshot_date: string
          total_assets: number
          total_liabilities: number
          user_id?: string
        }
        Update: {
          created_at?: string | null
          id?: string
          net_worth?: number
          snapshot_date?: string
          total_assets?: number
          total_liabilities?: number
          user_id?: string
        }
        Relationships: []
      }
      wm_real_estate: {
        Row: {
          address: string
          created_at: string | null
          estimated_market_value: number
          id: string
          mortgage_account_id: string | null
          purchase_date: string
          purchase_price: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          address: string
          created_at?: string | null
          estimated_market_value: number
          id?: string
          mortgage_account_id?: string | null
          purchase_date: string
          purchase_price: number
          updated_at?: string | null
          user_id?: string
        }
        Update: {
          address?: string
          created_at?: string | null
          estimated_market_value?: number
          id?: string
          mortgage_account_id?: string | null
          purchase_date?: string
          purchase_price?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wm_real_estate_mortgage_account_id_fkey"
            columns: ["mortgage_account_id"]
            isOneToOne: false
            referencedRelation: "wm_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      wm_retirement_inputs: {
        Row: {
          current_age: number
          expected_return_rate: number
          id: string
          inflation_rate: number
          monthly_contribution: number
          retirement_duration_years: number
          social_security_benefit: number
          target_monthly_income: number
          target_retirement_age: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          current_age: number
          expected_return_rate: number
          id?: string
          inflation_rate: number
          monthly_contribution: number
          retirement_duration_years: number
          social_security_benefit?: number
          target_monthly_income: number
          target_retirement_age: number
          updated_at?: string | null
          user_id?: string
        }
        Update: {
          current_age?: number
          expected_return_rate?: number
          id?: string
          inflation_rate?: number
          monthly_contribution?: number
          retirement_duration_years?: number
          social_security_benefit?: number
          target_monthly_income?: number
          target_retirement_age?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      wm_trades_log: {
        Row: {
          account_id: string
          action: string
          created_at: string | null
          gmail_message_id: string | null
          id: string
          price_per_share: number
          quantity: number
          security_name: string | null
          source: string
          ticker: string
          total_value: number
          trade_date: string
          user_id: string
        }
        Insert: {
          account_id: string
          action: string
          created_at?: string | null
          gmail_message_id?: string | null
          id?: string
          price_per_share: number
          quantity: number
          security_name?: string | null
          source?: string
          ticker: string
          total_value: number
          trade_date: string
          user_id?: string
        }
        Update: {
          account_id?: string
          action?: string
          created_at?: string | null
          gmail_message_id?: string | null
          id?: string
          price_per_share?: number
          quantity?: number
          security_name?: string | null
          source?: string
          ticker?: string
          total_value?: number
          trade_date?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wm_trades_log_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "wm_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      wm_unmatched_emails: {
        Row: {
          body_preview: string | null
          created_at: string | null
          gmail_message_id: string
          id: string
          matched: boolean
          matched_account_id: string | null
          received_at: string
          sender: string
          subject: string
          user_id: string
        }
        Insert: {
          body_preview?: string | null
          created_at?: string | null
          gmail_message_id: string
          id?: string
          matched?: boolean
          matched_account_id?: string | null
          received_at: string
          sender: string
          subject: string
          user_id?: string
        }
        Update: {
          body_preview?: string | null
          created_at?: string | null
          gmail_message_id?: string
          id?: string
          matched?: boolean
          matched_account_id?: string | null
          received_at?: string
          sender?: string
          subject?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wm_unmatched_emails_matched_account_id_fkey"
            columns: ["matched_account_id"]
            isOneToOne: false
            referencedRelation: "wm_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      monthly_category_stats: {
        Row: {
          account_id: string | null
          amount: number | null
          category_id: string | null
          created_at: string | null
          date: string | null
          description: string | null
          id: string | null
          is_split: boolean | null
          parent_id: string | null
          status: string | null
          upload_source: string | null
          user_id: string | null
        }
        Insert: {
          account_id?: string | null
          amount?: number | null
          category_id?: string | null
          created_at?: string | null
          date?: string | null
          description?: string | null
          id?: string | null
          is_split?: boolean | null
          parent_id?: string | null
          status?: string | null
          upload_source?: string | null
          user_id?: string | null
        }
        Update: {
          account_id?: string | null
          amount?: number | null
          category_id?: string | null
          created_at?: string | null
          date?: string | null
          description?: string | null
          id?: string | null
          is_split?: boolean | null
          parent_id?: string | null
          status?: string | null
          upload_source?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "budget_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "monthly_category_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      ensure_budgets_for_month:
        | { Args: { target_month: string }; Returns: undefined }
        | {
            Args: { target_month: number; target_year: number }
            Returns: undefined
          }
      find_duplicate_transactions: {
        Args: never
        Returns: {
          amount: number
          description: string
          duplicate_count: number
          transaction_date: string
          transaction_ids: string[]
        }[]
      }
      get_budget_with_rollover: {
        Args: { p_month: number; p_year: number }
        Returns: {
          actual_spent: number
          budget_limit: number
          category_id: string
          category_type: string
          effective_budget: number
          group_name: string
          line_item_name: string
          rollover: number
        }[]
      }
      get_cash_flow: {
        Args: { p_months?: number }
        Returns: {
          expenses: number
          income: number
          month_num: number
          net: number
          year_num: number
        }[]
      }
      get_category_rollover: {
        Args: {
          target_category_uuid: string
          target_month: number
          target_year: number
        }
        Returns: number
      }
      get_spending_by_month: {
        Args: { p_months?: number }
        Returns: {
          group_name: string
          month_num: number
          total: number
          year_num: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
