alter table public.transactions
  add column if not exists categorization_status text not null default 'uncategorized';

update public.transactions transaction_row
set categorization_status = case
  when transaction_row.status = 'Confirmed' then 'final'
  when transaction_row.category_id is not null or transaction_row.is_split is true then 'pending'
  else 'uncategorized'
end;

update public.transactions allocation
set categorization_status = case
  when allocation.status = 'Confirmed' then 'final'
  else parent.categorization_status
end
from public.transactions parent
where allocation.parent_id = parent.id
  and allocation.user_id = parent.user_id;

alter table public.transactions
  drop constraint if exists transactions_categorization_status_check;

alter table public.transactions
  add constraint transactions_categorization_status_check
  check (categorization_status in ('uncategorized', 'pending', 'final'));

create index if not exists transactions_uncategorized_queue_idx
  on public.transactions (user_id, created_at, id)
  where categorization_status = 'uncategorized'
    and parent_id is null
    and is_split is not true
    and coalesce(external_status, '') <> 'removed';

create index if not exists transactions_final_description_match_idx
  on public.transactions (
    user_id,
    account_id,
    (lower(regexp_replace(btrim(coalesce(description, '')), '\s+', ' ', 'g'))),
    category_id
  )
  where categorization_status = 'final'
    and category_id is not null;

create or replace function public.apply_transaction_categorizations(p_items jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
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
$$;

revoke execute on function public.apply_transaction_categorizations(jsonb)
  from public, anon;
grant execute on function public.apply_transaction_categorizations(jsonb)
  to authenticated;

create or replace function public.get_historical_categorization_matches(
  p_transaction_ids uuid[]
)
returns table(transaction_id uuid, category_id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
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
$$;

revoke execute on function public.get_historical_categorization_matches(uuid[])
  from public, anon;
grant execute on function public.get_historical_categorization_matches(uuid[])
  to authenticated;

create or replace function public.save_transaction_split(
  p_parent_id uuid,
  p_allocations jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
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
$$;

create or replace function public.unsplit_transaction(p_parent_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
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
$$;

revoke execute on function public.save_transaction_split(uuid, jsonb)
  from public, anon;
revoke execute on function public.unsplit_transaction(uuid)
  from public, anon;
grant execute on function public.save_transaction_split(uuid, jsonb)
  to authenticated;
grant execute on function public.unsplit_transaction(uuid)
  to authenticated;

create or replace view public.effective_transactions
with (security_invoker = true)
as
select
  transaction_row.id,
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
from public.transactions transaction_row
where transaction_row.parent_id is null
  and transaction_row.user_id = (select auth.uid())
  and transaction_row.is_split is not true
  and coalesce(transaction_row.external_status, '') <> 'removed'

union all

select
  allocation.id,
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
from public.transactions allocation
join public.transactions parent
  on parent.id = allocation.parent_id
 and parent.user_id = allocation.user_id
where parent.is_split is true
  and parent.user_id = (select auth.uid())
  and coalesce(parent.external_status, '') <> 'removed';

revoke all on table public.effective_transactions from public, anon;
grant select on table public.effective_transactions to authenticated, service_role;

create or replace function public.get_monthly_uncategorized_summary(
  p_year integer,
  p_month integer
)
returns table(
  transaction_count bigint,
  total_amount numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
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
$$;

revoke execute on function public.get_monthly_uncategorized_summary(integer, integer)
  from public, anon;
grant execute on function public.get_monthly_uncategorized_summary(integer, integer)
  to authenticated;
