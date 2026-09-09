-- SYNTHETIC TEST ENVIRONMENT ONLY. Schema contracts inspected read-only on 2026-09-08.
-- Contains no financial records, secrets, project IDs, or real users.
-- This is not a backup, deployment migration, or recreation of the shared database.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION public.uuid_generate_v4() RETURNS uuid LANGUAGE sql VOLATILE AS $$ SELECT gen_random_uuid() $$;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;

CREATE TABLE public."accounts" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "institution" text NOT NULL,
  "type" text,
  "current_balance" numeric(15,2) DEFAULT 0.00,
  "last_synced_at" timestamp with time zone DEFAULT now(),
  "initial_value" numeric(15,2),
  "initial_date" date DEFAULT CURRENT_DATE,
  "user_id" uuid DEFAULT auth.uid(),
  "plaid_account_id" text,
  "hidden" boolean DEFAULT false NOT NULL,
  "connection_provider" text DEFAULT 'manual'::text NOT NULL,
  "external_account_id" text
);

CREATE TABLE public."budget_categories" (
  "group_name" text NOT NULL,
  "line_item_name" text NOT NULL,
  "category_type" text,
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid DEFAULT auth.uid()
);

CREATE TABLE public."budgets" (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "category_id" uuid,
  "year_number" integer NOT NULL,
  "month_number" integer NOT NULL,
  "budget_limit" numeric(15,2) DEFAULT 0,
  "user_id" uuid DEFAULT auth.uid() NOT NULL
);

CREATE TABLE public."transactions" (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "date" date NOT NULL,
  "description" text,
  "amount" numeric(15,2) NOT NULL,
  "category_id" uuid,
  "account_id" uuid,
  "status" text DEFAULT 'Unconfirmed'::text,
  "upload_source" text DEFAULT 'n8n_strand'::text,
  "created_at" timestamp with time zone DEFAULT now(),
  "parent_id" uuid,
  "is_split" boolean DEFAULT false,
  "user_id" uuid DEFAULT auth.uid() NOT NULL,
  "category" text,
  "account" text,
  "source" text DEFAULT 'manual'::text,
  "plaid_transaction_id" text,
  "not_duplicate" boolean DEFAULT false NOT NULL,
  "connection_provider" text DEFAULT 'manual'::text NOT NULL,
  "external_transaction_id" text,
  "external_status" text,
  "categorization_status" text DEFAULT 'uncategorized'::text NOT NULL
);

CREATE TABLE public."bank_connections" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "provider" text NOT NULL,
  "provider_enrollment_id" text NOT NULL,
  "access_token" text NOT NULL,
  "institution_name" text,
  "status" text DEFAULT 'active'::text NOT NULL,
  "last_synced_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "user_id" uuid,
  "sync_cursor" text,
  "institution_id" text,
  "error_code" text,
  "error_message" text,
  "last_webhook_at" timestamp with time zone
);

CREATE TABLE public."plaid_items" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "access_token" text NOT NULL,
  "institution_name" text,
  "cursor" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "item_id" text,
  "user_id" uuid
);

CREATE TABLE public."statement_reconciliation_reviews" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "report_id" text NOT NULL,
  "source_record_id" text NOT NULL,
  "review_type" text NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "statement_account_key" text NOT NULL,
  "account_id" uuid,
  "account_name" text,
  "transaction_date" date NOT NULL,
  "posted_date" date,
  "proposed_date" date NOT NULL,
  "amount" numeric NOT NULL,
  "description" text NOT NULL,
  "statement_file" text NOT NULL,
  "statement_period_start" date,
  "statement_period_end" date,
  "page" integer,
  "row_reference" text,
  "candidate_transaction_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  "candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "reason" text,
  "proposed_transaction" jsonb NOT NULL,
  "risk_flags" text[] DEFAULT '{}'::text[] NOT NULL,
  "decision_note" text,
  "matched_transaction_id" uuid,
  "imported_transaction_id" uuid,
  "reviewed_at" timestamp with time zone,
  "reviewed_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public."accounts" ADD CONSTRAINT "accounts_pkey" PRIMARY KEY (id);
ALTER TABLE public."bank_connections" ADD CONSTRAINT "bank_connections_pkey" PRIMARY KEY (id);
ALTER TABLE public."budget_categories" ADD CONSTRAINT "budget_categories_category_type_check" CHECK ((category_type = ANY (ARRAY['income'::text, 'expense'::text, 'transfer'::text, 'Income'::text, 'Expense'::text, 'Transfer'::text])));
ALTER TABLE public."budget_categories" ADD CONSTRAINT "categories_id_key" UNIQUE (id);
ALTER TABLE public."budget_categories" ADD CONSTRAINT "categories_pkey" PRIMARY KEY (id);
ALTER TABLE public."budgets" ADD CONSTRAINT "budgets_category_id_year_number_month_number_key" UNIQUE (category_id, year_number, month_number);
ALTER TABLE public."budgets" ADD CONSTRAINT "budgets_month_number_check" CHECK (((month_number >= 1) AND (month_number <= 12)));
ALTER TABLE public."budgets" ADD CONSTRAINT "budgets_pkey" PRIMARY KEY (id);
ALTER TABLE public."budgets" ADD CONSTRAINT "unique_budget_entry" UNIQUE (user_id, category_id, year_number, month_number);
ALTER TABLE public."plaid_items" ADD CONSTRAINT "plaid_items_pkey" PRIMARY KEY (id);
ALTER TABLE public."statement_reconciliation_reviews" ADD CONSTRAINT "statement_reconciliation_revi_user_id_report_id_source_reco_key" UNIQUE (user_id, report_id, source_record_id, review_type);
ALTER TABLE public."statement_reconciliation_reviews" ADD CONSTRAINT "statement_reconciliation_reviews_pkey" PRIMARY KEY (id);
ALTER TABLE public."statement_reconciliation_reviews" ADD CONSTRAINT "statement_reconciliation_reviews_review_type_check" CHECK ((review_type = ANY (ARRAY['proposed_import'::text, 'possible_match'::text, 'conflict'::text, 'likely_duplicate'::text])));
ALTER TABLE public."statement_reconciliation_reviews" ADD CONSTRAINT "statement_reconciliation_reviews_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'matched'::text, 'imported'::text, 'legitimate_duplicate'::text, 'ignored'::text])));
ALTER TABLE public."transactions" ADD CONSTRAINT "transactions_categorization_status_check" CHECK ((categorization_status = ANY (ARRAY['uncategorized'::text, 'pending'::text, 'final'::text])));
ALTER TABLE public."transactions" ADD CONSTRAINT "transactions_pkey" PRIMARY KEY (id);
ALTER TABLE public."accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id);
ALTER TABLE public."budget_categories" ADD CONSTRAINT "budget_categories_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id);
ALTER TABLE public."budgets" ADD CONSTRAINT "budgets_category_id_fkey" FOREIGN KEY (category_id) REFERENCES budget_categories(id) ON DELETE CASCADE;
ALTER TABLE public."budgets" ADD CONSTRAINT "budgets_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id);
ALTER TABLE public."statement_reconciliation_reviews" ADD CONSTRAINT "statement_reconciliation_reviews_account_id_fkey" FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT;
ALTER TABLE public."statement_reconciliation_reviews" ADD CONSTRAINT "statement_reconciliation_reviews_imported_transaction_id_fkey" FOREIGN KEY (imported_transaction_id) REFERENCES transactions(id) ON DELETE SET NULL;
ALTER TABLE public."statement_reconciliation_reviews" ADD CONSTRAINT "statement_reconciliation_reviews_matched_transaction_id_fkey" FOREIGN KEY (matched_transaction_id) REFERENCES transactions(id) ON DELETE SET NULL;
ALTER TABLE public."statement_reconciliation_reviews" ADD CONSTRAINT "statement_reconciliation_reviews_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public."statement_reconciliation_reviews" ADD CONSTRAINT "statement_reconciliation_reviews_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."transactions" ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE public."transactions" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY (category_id) REFERENCES budget_categories(id) ON DELETE SET NULL;
ALTER TABLE public."transactions" ADD CONSTRAINT "transactions_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES transactions(id) ON DELETE CASCADE;
ALTER TABLE public."transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id);
CREATE UNIQUE INDEX accounts_plaid_account_id_idx ON public.accounts USING btree (plaid_account_id) WHERE (plaid_account_id IS NOT NULL);
CREATE UNIQUE INDEX accounts_provider_external_account_id_key ON public.accounts USING btree (connection_provider, external_account_id);
CREATE UNIQUE INDEX bank_connections_provider_enrollment_user_key ON public.bank_connections USING btree (provider, provider_enrollment_id, user_id);
CREATE UNIQUE INDEX bank_connections_active_plaid_institution_user_key ON public.bank_connections USING btree (user_id, institution_id) WHERE ((provider = 'plaid'::text) AND (status = 'active'::text) AND (user_id IS NOT NULL) AND (institution_id IS NOT NULL));
CREATE UNIQUE INDEX budgets_month_year_category_uq ON public.budgets USING btree (category_id, year_number, month_number);
CREATE INDEX idx_budgets_year_month ON public.budgets USING btree (year_number, month_number);
CREATE INDEX statement_reconciliation_reviews_pending_idx ON public.statement_reconciliation_reviews USING btree (user_id, status, proposed_date DESC);
CREATE INDEX statement_reconciliation_reviews_type_idx ON public.statement_reconciliation_reviews USING btree (user_id, review_type, status);
CREATE INDEX statement_reconciliation_reviews_account_idx ON public.statement_reconciliation_reviews USING btree (account_id);
CREATE INDEX statement_reconciliation_reviews_matched_transaction_idx ON public.statement_reconciliation_reviews USING btree (matched_transaction_id) WHERE (matched_transaction_id IS NOT NULL);
CREATE INDEX statement_reconciliation_reviews_imported_transaction_idx ON public.statement_reconciliation_reviews USING btree (imported_transaction_id) WHERE (imported_transaction_id IS NOT NULL);
CREATE INDEX statement_reconciliation_reviews_reviewed_by_idx ON public.statement_reconciliation_reviews USING btree (reviewed_by) WHERE (reviewed_by IS NOT NULL);
CREATE INDEX idx_transactions_date ON public.transactions USING btree (date);
CREATE INDEX idx_transactions_category ON public.transactions USING btree (category_id);
CREATE INDEX idx_transactions_account ON public.transactions USING btree (account_id);
CREATE INDEX idx_transactions_user_status ON public.transactions USING btree (user_id, status);
CREATE INDEX idx_transactions_user_category ON public.transactions USING btree (user_id, category_id);
CREATE INDEX idx_transactions_description_search ON public.transactions USING gin (to_tsvector('english'::regconfig, description));
CREATE UNIQUE INDEX uq_plaid_txn ON public.transactions USING btree (plaid_transaction_id) WHERE (plaid_transaction_id IS NOT NULL);
CREATE INDEX idx_txns_date ON public.transactions USING btree (date DESC);
CREATE INDEX idx_txns_category ON public.transactions USING btree (category);
CREATE INDEX idx_txns_account ON public.transactions USING btree (account);
CREATE UNIQUE INDEX transactions_plaid_transaction_id_idx ON public.transactions USING btree (plaid_transaction_id) WHERE (plaid_transaction_id IS NOT NULL);
CREATE INDEX idx_transactions_category_date ON public.transactions USING btree (category_id, date);
CREATE UNIQUE INDEX transactions_provider_external_transaction_user_key ON public.transactions USING btree (connection_provider, external_transaction_id, user_id) WHERE (external_transaction_id IS NOT NULL);
CREATE INDEX transactions_parent_id_idx ON public.transactions USING btree (parent_id) WHERE (parent_id IS NOT NULL);
CREATE INDEX transactions_uncategorized_queue_idx ON public.transactions USING btree (user_id, created_at, id) WHERE ((categorization_status = 'uncategorized'::text) AND (parent_id IS NULL) AND (is_split IS NOT TRUE) AND (COALESCE(external_status, ''::text) <> 'removed'::text));
CREATE INDEX transactions_final_description_match_idx ON public.transactions USING btree (user_id, account_id, lower(regexp_replace(btrim(COALESCE(description, ''::text)), '\s+'::text, ' '::text, 'g'::text)), category_id) WHERE ((categorization_status = 'final'::text) AND (category_id IS NOT NULL));
ALTER TABLE public."accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."bank_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."budget_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."budgets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."plaid_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."statement_reconciliation_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."transactions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Dynamic User Access" ON public."accounts" FOR ALL TO "authenticated" USING ((auth.uid() = user_id)) ;
CREATE POLICY "Users can manage their accounts" ON public."accounts" FOR ALL TO "public" USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "auth_cleanup_accounts" ON public."accounts" FOR ALL TO "authenticated" USING ((auth.uid() = user_id)) ;
CREATE POLICY "Users can manage their bank connections" ON public."bank_connections" FOR ALL TO "public" USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "Dynamic User Access" ON public."budget_categories" FOR ALL TO "authenticated" USING ((auth.uid() = user_id)) ;
CREATE POLICY "Users can manage their budget categories" ON public."budget_categories" FOR ALL TO "public" USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "Dynamic User Access" ON public."budgets" FOR ALL TO "authenticated" USING ((auth.uid() = user_id)) ;
CREATE POLICY "Users can manage their budgets" ON public."budgets" FOR ALL TO "public" USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "auth_cleanup_budgets" ON public."budgets" FOR ALL TO "authenticated" USING ((auth.uid() = user_id)) ;
CREATE POLICY "Users can manage their bank items" ON public."plaid_items" FOR ALL TO "public" USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "Users can update their statement reviews" ON public."statement_reconciliation_reviews" FOR UPDATE TO "authenticated" USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can view their statement reviews" ON public."statement_reconciliation_reviews" FOR SELECT TO "authenticated" USING ((( SELECT auth.uid() AS uid) = user_id)) ;
CREATE POLICY "Dynamic User Access" ON public."transactions" FOR ALL TO "authenticated" USING ((auth.uid() = user_id)) ;
CREATE POLICY "Users can manage their transactions" ON public."transactions" FOR ALL TO "public" USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "auth_cleanup_transactions" ON public."transactions" FOR ALL TO "authenticated" USING ((auth.uid() = user_id)) ;
CREATE POLICY "dynamic_access" ON public."transactions" FOR ALL TO "authenticated" USING ((auth.uid() = user_id)) ;

CREATE VIEW public."effective_transactions" WITH (security_invoker=true) AS  SELECT transaction_row.id,
    transaction_row.date,
    transaction_row.description,
    transaction_row.amount,
    transaction_row.category_id,
    transaction_row.account_id,
    transaction_row.status,
    transaction_row.upload_source,
    transaction_row.created_at,
    transaction_row.parent_id,
    transaction_row.is_split,
    transaction_row.user_id,
    transaction_row.source,
    transaction_row.external_status,
    transaction_row.categorization_status
   FROM transactions transaction_row
  WHERE ((transaction_row.parent_id IS NULL) AND (transaction_row.user_id = ( SELECT auth.uid() AS uid)) AND (transaction_row.is_split IS NOT TRUE) AND (COALESCE(transaction_row.external_status, ''::text) <> 'removed'::text))
UNION ALL
 SELECT allocation.id,
    parent.date,
    allocation.description,
    allocation.amount,
    allocation.category_id,
    parent.account_id,
    parent.status,
    allocation.upload_source,
    allocation.created_at,
    allocation.parent_id,
    allocation.is_split,
    allocation.user_id,
    allocation.source,
    parent.external_status,
    parent.categorization_status
   FROM (transactions allocation
     JOIN transactions parent ON (((parent.id = allocation.parent_id) AND (parent.user_id = allocation.user_id))))
  WHERE ((parent.is_split IS TRUE) AND (parent.user_id = ( SELECT auth.uid() AS uid)) AND (COALESCE(parent.external_status, ''::text) <> 'removed'::text));

CREATE VIEW public."monthly_category_stats" WITH (security_invoker=true) AS  SELECT id,
    date,
    description,
    amount,
    category_id,
    account_id,
    status,
    upload_source,
    created_at,
    parent_id,
    is_split,
    user_id
   FROM transactions;

CREATE OR REPLACE FUNCTION public.apply_transaction_categorizations(p_items jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_updated integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Categorization items must be an array';
  end if;

  with requested as (
    select distinct item.transaction_id, item.category_id
    from jsonb_to_recordset(p_items) as item(
      transaction_id uuid,
      category_id uuid
    )
    where item.transaction_id is not null
      and item.category_id is not null
  ),
  valid as (
    select requested.transaction_id, requested.category_id
    from requested
    join public.budget_categories category
      on category.id = requested.category_id
     and category.user_id = v_user_id
  ),
  updated as (
    update public.transactions transaction_row
    set category_id = valid.category_id,
        categorization_status = 'pending'
    from valid
    where transaction_row.id = valid.transaction_id
      and transaction_row.user_id = v_user_id
      and transaction_row.categorization_status = 'uncategorized'
      and transaction_row.parent_id is null
      and transaction_row.is_split is not true
      and coalesce(transaction_row.external_status, '') <> 'removed'
    returning transaction_row.id
  )
  select count(*)::integer into v_updated from updated;

  return v_updated;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ensure_budgets_for_month(target_month date)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  m date := date_trunc('month', target_month)::date;
  prev date := (m - interval '1 month')::date;
begin
  -- 1) Copy previous month budgets forward (insert-only)
  insert into public.budgets (budget_month, category_id, amount)
  select m, b.category_id, b.amount
  from public.budgets b
  where b.budget_month = prev
  on conflict (budget_month, category_id) do nothing;

  -- 2) Ensure every category has a row (defaults to 0 if still missing)
  insert into public.budgets (budget_month, category_id, amount)
  select m, c.id, 0
  from public.budget_categories c
  where not exists (
    select 1 from public.budgets b2
    where b2.budget_month = m and b2.category_id = c.id
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ensure_budgets_for_month(target_year integer, target_month integer)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  prev_month int;
  prev_year int;
begin
  -- Calculate previous month/year logic
  if target_month = 1 then
    prev_month := 12;
    prev_year := target_year - 1;
  else
    prev_month := target_month - 1;
    prev_year := target_year;
  end if;

  -- 1) Copy previous month budgets forward (if they exist)
  insert into public.budgets (category_id, year_number, month_number, budget_limit)
  select category_id, target_year, target_month, budget_limit
  from public.budgets
  where year_number = prev_year and month_number = prev_month
  on conflict (category_id, year_number, month_number) do nothing;

  -- 2) Ensure EVERY category has a row for this month (default to 0 if still missing)
  insert into public.budgets (category_id, year_number, month_number, budget_limit)
  select id, target_year, target_month, 0
  from public.budget_categories
  on conflict (category_id, year_number, month_number) do nothing;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_budget_with_rollover(p_year integer, p_month integer)
 RETURNS TABLE(category_id uuid, group_name text, line_item_name text, category_type text, budget_limit numeric, actual_spent numeric, rollover numeric, effective_budget numeric)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  return query
  with monthly_data as (
    select
      category.id as cat_id,
      category.category_type as cat_type,
      budget.year_number,
      budget.month_number,
      coalesce(budget.budget_limit, 0) as budget,
      coalesce(sum(abs(transaction_row.amount)), 0) as spent
    from public.budget_categories category
    join public.budgets budget on budget.category_id = category.id
    left join public.effective_transactions transaction_row
      on transaction_row.category_id = category.id
     and extract(year from transaction_row.date)::integer = budget.year_number
     and extract(month from transaction_row.date)::integer = budget.month_number
    where category.user_id = (select auth.uid())
      and budget.user_id = (select auth.uid())
      and (budget.year_number * 12 + budget.month_number) <= (p_year * 12 + p_month)
    group by
      category.id,
      category.category_type,
      budget.year_number,
      budget.month_number,
      budget.budget_limit
  ),
  with_rollover as (
    select
      cat_id,
      cat_type,
      year_number,
      month_number,
      budget,
      spent,
      case
        when lower(cat_type) = 'expense' then
          coalesce(
            sum(budget - spent) over (
              partition by cat_id
              order by year_number, month_number
              rows between unbounded preceding and 1 preceding
            ),
            0
          )
        else 0
      end as roll
    from monthly_data
  )
  select
    rolled.cat_id,
    category.group_name,
    category.line_item_name,
    category.category_type,
    rolled.budget,
    rolled.spent,
    rolled.roll,
    rolled.budget + rolled.roll
  from with_rollover rolled
  join public.budget_categories category on category.id = rolled.cat_id
  where rolled.year_number = p_year
    and rolled.month_number = p_month;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_cash_flow(p_months integer DEFAULT 12)
 RETURNS TABLE(year_num integer, month_num integer, income numeric, expenses numeric, net numeric)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  return query
  select
    extract(year from transaction_row.date)::integer,
    extract(month from transaction_row.date)::integer,
    coalesce(sum(case when transaction_row.amount > 0 then transaction_row.amount else 0 end), 0),
    coalesce(sum(case when transaction_row.amount < 0 then abs(transaction_row.amount) else 0 end), 0),
    coalesce(sum(transaction_row.amount), 0)
  from public.transactions transaction_row
  where transaction_row.parent_id is null
    and transaction_row.user_id = (select auth.uid())
    and coalesce(transaction_row.external_status, '') <> 'removed'
    and transaction_row.date >= (current_date - (p_months || ' months')::interval)
  group by 1, 2
  order by 1, 2;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_category_rollover(target_category_uuid uuid, target_year integer, target_month integer)
 RETURNS numeric
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    total_rollover DECIMAL := 0;
BEGIN
    -- Sum up all budget limits minus all actual spends from the beginning of time
    -- up until the END of the month BEFORE the target month.
    SELECT COALESCE(SUM(b.budget_limit - COALESCE(s.total_spent, 0)), 0)
    INTO total_rollover
    FROM budgets b
    LEFT JOIN (
        SELECT
            category_id,
            EXTRACT(YEAR FROM date) as y,
            EXTRACT(MONTH FROM date) as m,
            SUM(amount) as total_spent
        FROM transactions
        GROUP BY 1, 2, 3
    ) s ON b.category_id = s.category_id AND b.year = s.y AND b.month = s.m
    WHERE b.category_id = target_category_uuid
      AND (b.year < target_year OR (b.year = target_year AND b.month < target_month));

    RETURN total_rollover;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_historical_categorization_matches(p_transaction_ids uuid[])
 RETURNS TABLE(transaction_id uuid, category_id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with candidates as (
    select
      transaction_row.id,
      transaction_row.account_id,
      lower(regexp_replace(btrim(coalesce(transaction_row.description, '')), '\s+', ' ', 'g'))
        as normalized_description
    from public.transactions transaction_row
    where transaction_row.id = any(p_transaction_ids)
      and transaction_row.user_id = (select auth.uid())
      and transaction_row.categorization_status = 'uncategorized'
      and transaction_row.parent_id is null
      and transaction_row.is_split is not true
      and coalesce(transaction_row.external_status, '') <> 'removed'
  )
  select
    candidate.id,
    max(history.category_id::text)::uuid
  from candidates candidate
  join public.transactions history
    on history.user_id = (select auth.uid())
   and history.account_id is not distinct from candidate.account_id
   and history.categorization_status = 'final'
   and history.category_id is not null
   and lower(regexp_replace(btrim(coalesce(history.description, '')), '\s+', ' ', 'g'))
       = candidate.normalized_description
  where candidate.normalized_description <> ''
  group by candidate.id
  having count(distinct history.category_id) = 1;
$function$
;

CREATE OR REPLACE FUNCTION public.get_spending_by_month(p_months integer DEFAULT 12)
 RETURNS TABLE(year_num integer, month_num integer, group_name text, total numeric)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  return query
  select
    extract(year from transaction_row.date)::integer,
    extract(month from transaction_row.date)::integer,
    category.group_name,
    sum(abs(transaction_row.amount))
  from public.effective_transactions transaction_row
  join public.budget_categories category on category.id = transaction_row.category_id
  where category.category_type in ('Expense', 'expense')
    and category.user_id = (select auth.uid())
    and transaction_row.date >= (current_date - (p_months || ' months')::interval)
  group by 1, 2, category.group_name
  order by 1, 2;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_statement_reconciliation_review(p_review_id uuid, p_decision text, p_candidate_transaction_id uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_review public.statement_reconciliation_reviews%rowtype;
  v_transaction_id uuid;
  v_existing_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_decision not in ('matched', 'imported', 'legitimate_duplicate', 'ignored') then
    raise exception 'Unsupported review decision';
  end if;

  select * into v_review
  from public.statement_reconciliation_reviews
  where id = p_review_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Review item not found';
  end if;

  if v_review.status <> 'pending' then
    return jsonb_build_object('reviewId', v_review.id, 'status', v_review.status,
      'transactionId', coalesce(v_review.imported_transaction_id, v_review.matched_transaction_id));
  end if;

  if p_decision = 'matched' then
    if p_candidate_transaction_id is null
       or not (p_candidate_transaction_id = any(v_review.candidate_transaction_ids)) then
      raise exception 'Select one of the listed candidate transactions';
    end if;

    perform 1 from public.transactions
    where id = p_candidate_transaction_id and user_id = v_user_id;
    if not found then raise exception 'Candidate transaction not found'; end if;
    v_transaction_id := p_candidate_transaction_id;
  elsif p_decision = 'imported' then
    perform 1 from public.accounts
    where id = v_review.account_id and user_id = v_user_id;
    if not found then raise exception 'Mapped account not found'; end if;

    select id into v_existing_id
    from public.transactions
    where user_id = v_user_id
      and connection_provider = coalesce(v_review.proposed_transaction->>'connection_provider', 'statement')
      and external_transaction_id = v_review.proposed_transaction->>'external_transaction_id'
    limit 1;

    if v_existing_id is not null then
      v_transaction_id := v_existing_id;
    else
      insert into public.transactions (
        user_id, account_id, account, date, amount, description, source,
        upload_source, connection_provider, external_transaction_id, external_status
      ) values (
        v_user_id,
        v_review.account_id,
        v_review.account_name,
        v_review.proposed_date,
        v_review.amount,
        v_review.description,
        coalesce(v_review.proposed_transaction->>'source', 'statement'),
        coalesce(v_review.proposed_transaction->>'upload_source', v_review.statement_file),
        coalesce(v_review.proposed_transaction->>'connection_provider', 'statement'),
        v_review.proposed_transaction->>'external_transaction_id',
        coalesce(v_review.proposed_transaction->>'external_status', 'posted')
      ) returning id into v_transaction_id;
    end if;
  end if;

  update public.statement_reconciliation_reviews
  set status = p_decision,
      decision_note = nullif(trim(p_note), ''),
      matched_transaction_id = case when p_decision = 'matched' then v_transaction_id else null end,
      imported_transaction_id = case when p_decision = 'imported' then v_transaction_id else null end,
      reviewed_at = now(), reviewed_by = v_user_id, updated_at = now()
  where id = v_review.id;

  return jsonb_build_object('reviewId', v_review.id, 'status', p_decision,
    'transactionId', v_transaction_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_transaction_split(p_parent_id uuid, p_allocations jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_parent public.transactions%rowtype;
  v_user_id uuid := (select auth.uid());
  v_allocation_count integer;
  v_category_count integer;
  v_total numeric;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if jsonb_typeof(p_allocations) is distinct from 'array' then
    raise exception 'Allocations must be an array';
  end if;

  select *
  into v_parent
  from public.transactions
  where id = p_parent_id
    and user_id = v_user_id
    and parent_id is null
    and coalesce(external_status, '') <> 'removed'
  for update;

  if not found then
    raise exception 'Transaction not found or cannot be split';
  end if;

  if round(v_parent.amount, 2) = 0 then
    raise exception 'Zero-value transactions cannot be split';
  end if;

  with allocations as (
    select *
    from jsonb_to_recordset(p_allocations) as allocation(
      category_id uuid,
      amount numeric,
      description text
    )
  )
  select count(*), coalesce(sum(amount), 0)
  into v_allocation_count, v_total
  from allocations;

  if v_allocation_count < 2 then
    raise exception 'A split requires at least two allocations';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_allocations) as allocation(
      category_id uuid,
      amount numeric,
      description text
    )
    where category_id is null
      or amount is null
      or amount = 0
      or round(amount, 2) <> amount
      or sign(amount) <> sign(v_parent.amount)
  ) then
    raise exception 'Every allocation needs a category and a non-zero amount with the transaction sign';
  end if;

  if round(v_total, 2) <> round(v_parent.amount, 2) then
    raise exception 'Allocation total must equal the transaction amount';
  end if;

  select count(*)
  into v_category_count
  from jsonb_to_recordset(p_allocations) as allocation(
    category_id uuid,
    amount numeric,
    description text
  )
  join public.budget_categories category
    on category.id = allocation.category_id
   and category.user_id = v_user_id;

  if v_category_count <> v_allocation_count then
    raise exception 'One or more categories are invalid';
  end if;

  delete from public.transactions
  where parent_id = v_parent.id
    and user_id = v_user_id;

  insert into public.transactions (
    date,
    description,
    amount,
    category_id,
    account_id,
    status,
    categorization_status,
    parent_id,
    is_split,
    source,
    upload_source,
    user_id
  )
  select
    v_parent.date,
    coalesce(nullif(btrim(allocation.description), ''), v_parent.description),
    allocation.amount,
    allocation.category_id,
    v_parent.account_id,
    v_parent.status,
    'final',
    v_parent.id,
    true,
    v_parent.source,
    v_parent.upload_source,
    v_user_id
  from jsonb_to_recordset(p_allocations) as allocation(
    category_id uuid,
    amount numeric,
    description text
  );

  update public.transactions
  set is_split = true,
      category_id = null,
      categorization_status = 'final'
  where id = v_parent.id
    and user_id = v_user_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.unsplit_transaction(p_parent_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  perform 1
  from public.transactions
  where id = p_parent_id
    and user_id = v_user_id
    and parent_id is null
    and is_split is true
  for update;

  if not found then
    raise exception 'Split transaction not found';
  end if;

  delete from public.transactions
  where parent_id = p_parent_id
    and user_id = v_user_id;

  update public.transactions
  set is_split = false,
      category_id = null,
      categorization_status = 'uncategorized'
  where id = p_parent_id
    and user_id = v_user_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.check_transaction_completeness()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- If Category or Account is missing, force status to 'Pending'
  IF NEW.category_id IS NULL OR NEW.account_id IS NULL THEN
    NEW.status := 'Pending';
  -- If everything is there but it was Pending, move it to Unconfirmed (Ready for Review)
  ELSIF NEW.status = 'Pending' AND NEW.category_id IS NOT NULL AND NEW.account_id IS NOT NULL THEN
    NEW.status := 'Unconfirmed';
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_monthly_uncategorized_summary(p_year integer, p_month integer)
 RETURNS TABLE(transaction_count bigint, total_amount numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    count(*) as transaction_count,
    coalesce(sum(abs(transaction_row.amount)), 0) as total_amount
  from public.effective_transactions transaction_row
  where transaction_row.user_id = (select auth.uid())
    and transaction_row.categorization_status = 'uncategorized'
    and transaction_row.date >= make_date(p_year, p_month, 1)
    and transaction_row.date < (
      make_date(p_year, p_month, 1) + interval '1 month'
    )::date;
$function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_transaction_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Define the "Minimum Viable Transaction"
  IF NEW.date IS NULL
     OR NEW.account_id IS NULL
     OR NEW.category_id IS NULL
     OR NEW.amount IS NULL THEN
    NEW.status := 'Pending';
  ELSE
    NEW.status := 'Confirmed';
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE TRIGGER bank_connections_set_updated_at BEFORE UPDATE ON public.bank_connections FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER tr_check_pending BEFORE INSERT OR UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION update_transaction_status();

CREATE TRIGGER trigger_check_completeness BEFORE INSERT OR UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION check_transaction_completeness();
GRANT INSERT ON public."accounts" TO "authenticated";
GRANT SELECT ON public."accounts" TO "authenticated";
GRANT UPDATE ON public."accounts" TO "authenticated";
GRANT DELETE ON public."accounts" TO "authenticated";
GRANT TRUNCATE ON public."accounts" TO "authenticated";
GRANT REFERENCES ON public."accounts" TO "authenticated";
GRANT TRIGGER ON public."accounts" TO "authenticated";
GRANT INSERT ON public."accounts" TO "service_role";
GRANT SELECT ON public."accounts" TO "service_role";
GRANT UPDATE ON public."accounts" TO "service_role";
GRANT DELETE ON public."accounts" TO "service_role";
GRANT TRUNCATE ON public."accounts" TO "service_role";
GRANT REFERENCES ON public."accounts" TO "service_role";
GRANT TRIGGER ON public."accounts" TO "service_role";
GRANT INSERT ON public."statement_reconciliation_reviews" TO "authenticated";
GRANT SELECT ON public."statement_reconciliation_reviews" TO "authenticated";
GRANT UPDATE ON public."statement_reconciliation_reviews" TO "authenticated";
GRANT DELETE ON public."statement_reconciliation_reviews" TO "authenticated";
GRANT TRUNCATE ON public."statement_reconciliation_reviews" TO "authenticated";
GRANT REFERENCES ON public."statement_reconciliation_reviews" TO "authenticated";
GRANT TRIGGER ON public."statement_reconciliation_reviews" TO "authenticated";
GRANT INSERT ON public."statement_reconciliation_reviews" TO "service_role";
GRANT SELECT ON public."statement_reconciliation_reviews" TO "service_role";
GRANT UPDATE ON public."statement_reconciliation_reviews" TO "service_role";
GRANT DELETE ON public."statement_reconciliation_reviews" TO "service_role";
GRANT TRUNCATE ON public."statement_reconciliation_reviews" TO "service_role";
GRANT REFERENCES ON public."statement_reconciliation_reviews" TO "service_role";
GRANT TRIGGER ON public."statement_reconciliation_reviews" TO "service_role";
GRANT INSERT ON public."budget_categories" TO "authenticated";
GRANT SELECT ON public."budget_categories" TO "authenticated";
GRANT UPDATE ON public."budget_categories" TO "authenticated";
GRANT DELETE ON public."budget_categories" TO "authenticated";
GRANT TRUNCATE ON public."budget_categories" TO "authenticated";
GRANT REFERENCES ON public."budget_categories" TO "authenticated";
GRANT TRIGGER ON public."budget_categories" TO "authenticated";
GRANT INSERT ON public."budget_categories" TO "service_role";
GRANT SELECT ON public."budget_categories" TO "service_role";
GRANT UPDATE ON public."budget_categories" TO "service_role";
GRANT DELETE ON public."budget_categories" TO "service_role";
GRANT TRUNCATE ON public."budget_categories" TO "service_role";
GRANT REFERENCES ON public."budget_categories" TO "service_role";
GRANT TRIGGER ON public."budget_categories" TO "service_role";
GRANT INSERT ON public."budgets" TO "authenticated";
GRANT SELECT ON public."budgets" TO "authenticated";
GRANT UPDATE ON public."budgets" TO "authenticated";
GRANT DELETE ON public."budgets" TO "authenticated";
GRANT TRUNCATE ON public."budgets" TO "authenticated";
GRANT REFERENCES ON public."budgets" TO "authenticated";
GRANT TRIGGER ON public."budgets" TO "authenticated";
GRANT INSERT ON public."budgets" TO "service_role";
GRANT SELECT ON public."budgets" TO "service_role";
GRANT UPDATE ON public."budgets" TO "service_role";
GRANT DELETE ON public."budgets" TO "service_role";
GRANT TRUNCATE ON public."budgets" TO "service_role";
GRANT REFERENCES ON public."budgets" TO "service_role";
GRANT TRIGGER ON public."budgets" TO "service_role";
GRANT INSERT ON public."transactions" TO "service_role";
GRANT SELECT ON public."transactions" TO "service_role";
GRANT UPDATE ON public."transactions" TO "service_role";
GRANT DELETE ON public."transactions" TO "service_role";
GRANT TRUNCATE ON public."transactions" TO "service_role";
GRANT REFERENCES ON public."transactions" TO "service_role";
GRANT TRIGGER ON public."transactions" TO "service_role";
GRANT INSERT ON public."transactions" TO "authenticated";
GRANT SELECT ON public."transactions" TO "authenticated";
GRANT UPDATE ON public."transactions" TO "authenticated";
GRANT DELETE ON public."transactions" TO "authenticated";
GRANT TRUNCATE ON public."transactions" TO "authenticated";
GRANT REFERENCES ON public."transactions" TO "authenticated";
GRANT TRIGGER ON public."transactions" TO "authenticated";
GRANT INSERT ON public."monthly_category_stats" TO "authenticated";
GRANT SELECT ON public."monthly_category_stats" TO "authenticated";
GRANT UPDATE ON public."monthly_category_stats" TO "authenticated";
GRANT DELETE ON public."monthly_category_stats" TO "authenticated";
GRANT TRUNCATE ON public."monthly_category_stats" TO "authenticated";
GRANT REFERENCES ON public."monthly_category_stats" TO "authenticated";
GRANT TRIGGER ON public."monthly_category_stats" TO "authenticated";
GRANT INSERT ON public."monthly_category_stats" TO "service_role";
GRANT SELECT ON public."monthly_category_stats" TO "service_role";
GRANT UPDATE ON public."monthly_category_stats" TO "service_role";
GRANT DELETE ON public."monthly_category_stats" TO "service_role";
GRANT TRUNCATE ON public."monthly_category_stats" TO "service_role";
GRANT REFERENCES ON public."monthly_category_stats" TO "service_role";
GRANT TRIGGER ON public."monthly_category_stats" TO "service_role";
GRANT INSERT ON public."plaid_items" TO "authenticated";
GRANT SELECT ON public."plaid_items" TO "authenticated";
GRANT UPDATE ON public."plaid_items" TO "authenticated";
GRANT DELETE ON public."plaid_items" TO "authenticated";
GRANT TRUNCATE ON public."plaid_items" TO "authenticated";
GRANT REFERENCES ON public."plaid_items" TO "authenticated";
GRANT TRIGGER ON public."plaid_items" TO "authenticated";
GRANT INSERT ON public."plaid_items" TO "service_role";
GRANT SELECT ON public."plaid_items" TO "service_role";
GRANT UPDATE ON public."plaid_items" TO "service_role";
GRANT DELETE ON public."plaid_items" TO "service_role";
GRANT TRUNCATE ON public."plaid_items" TO "service_role";
GRANT REFERENCES ON public."plaid_items" TO "service_role";
GRANT TRIGGER ON public."plaid_items" TO "service_role";
GRANT INSERT ON public."effective_transactions" TO "authenticated";
GRANT SELECT ON public."effective_transactions" TO "authenticated";
GRANT UPDATE ON public."effective_transactions" TO "authenticated";
GRANT DELETE ON public."effective_transactions" TO "authenticated";
GRANT TRUNCATE ON public."effective_transactions" TO "authenticated";
GRANT REFERENCES ON public."effective_transactions" TO "authenticated";
GRANT TRIGGER ON public."effective_transactions" TO "authenticated";
GRANT INSERT ON public."effective_transactions" TO "service_role";
GRANT SELECT ON public."effective_transactions" TO "service_role";
GRANT UPDATE ON public."effective_transactions" TO "service_role";
GRANT DELETE ON public."effective_transactions" TO "service_role";
GRANT TRUNCATE ON public."effective_transactions" TO "service_role";
GRANT REFERENCES ON public."effective_transactions" TO "service_role";
GRANT TRIGGER ON public."effective_transactions" TO "service_role";
GRANT INSERT ON public."bank_connections" TO "authenticated";
GRANT SELECT ON public."bank_connections" TO "authenticated";
GRANT UPDATE ON public."bank_connections" TO "authenticated";
GRANT DELETE ON public."bank_connections" TO "authenticated";
GRANT TRUNCATE ON public."bank_connections" TO "authenticated";
GRANT REFERENCES ON public."bank_connections" TO "authenticated";
GRANT TRIGGER ON public."bank_connections" TO "authenticated";
GRANT INSERT ON public."bank_connections" TO "service_role";
GRANT SELECT ON public."bank_connections" TO "service_role";
GRANT UPDATE ON public."bank_connections" TO "service_role";
GRANT DELETE ON public."bank_connections" TO "service_role";
GRANT TRUNCATE ON public."bank_connections" TO "service_role";
GRANT REFERENCES ON public."bank_connections" TO "service_role";
GRANT TRIGGER ON public."bank_connections" TO "service_role";
