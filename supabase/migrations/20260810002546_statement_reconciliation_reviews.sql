create table public.statement_reconciliation_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  report_id text not null,
  source_record_id text not null,
  review_type text not null check (review_type in ('proposed_import', 'possible_match', 'conflict', 'likely_duplicate')),
  status text not null default 'pending' check (status in ('pending', 'matched', 'imported', 'legitimate_duplicate', 'ignored')),
  statement_account_key text not null,
  account_id uuid references public.accounts(id) on delete restrict,
  account_name text,
  transaction_date date not null,
  posted_date date,
  proposed_date date not null,
  amount numeric not null,
  description text not null,
  statement_file text not null,
  statement_period_start date,
  statement_period_end date,
  page integer,
  row_reference text,
  candidate_transaction_ids uuid[] not null default '{}',
  candidates jsonb not null default '[]'::jsonb,
  reason text,
  proposed_transaction jsonb not null,
  risk_flags text[] not null default '{}',
  decision_note text,
  matched_transaction_id uuid references public.transactions(id) on delete set null,
  imported_transaction_id uuid references public.transactions(id) on delete set null,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, report_id, source_record_id, review_type)
);

create index statement_reconciliation_reviews_pending_idx
  on public.statement_reconciliation_reviews (user_id, status, proposed_date desc);
create index statement_reconciliation_reviews_type_idx
  on public.statement_reconciliation_reviews (user_id, review_type, status);

alter table public.statement_reconciliation_reviews enable row level security;

create policy "Users can view their statement reviews"
  on public.statement_reconciliation_reviews for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can update their statement reviews"
  on public.statement_reconciliation_reviews for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, update on public.statement_reconciliation_reviews to authenticated;
grant all on public.statement_reconciliation_reviews to service_role;

create or replace function public.resolve_statement_reconciliation_review(
  p_review_id uuid,
  p_decision text,
  p_candidate_transaction_id uuid default null,
  p_note text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
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
$$;

revoke all on function public.resolve_statement_reconciliation_review(uuid, text, uuid, text) from public, anon;
grant execute on function public.resolve_statement_reconciliation_review(uuid, text, uuid, text) to authenticated;
