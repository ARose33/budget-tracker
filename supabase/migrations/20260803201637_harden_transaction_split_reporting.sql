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
  transaction_row.external_status
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
  parent.external_status
from public.transactions allocation
join public.transactions parent
  on parent.id = allocation.parent_id
 and parent.user_id = allocation.user_id
where parent.is_split is true
  and parent.user_id = (select auth.uid())
  and coalesce(parent.external_status, '') <> 'removed';

revoke all on table public.effective_transactions from public, anon;
grant select on table public.effective_transactions to authenticated, service_role;

create or replace function public.get_budget_with_rollover(p_year integer, p_month integer)
returns table(
  category_id uuid,
  group_name text,
  line_item_name text,
  category_type text,
  budget_limit numeric,
  actual_spent numeric,
  rollover numeric,
  effective_budget numeric
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query
  with monthly_data as (
    select
      category.id as cat_id,
      budget.year_number,
      budget.month_number,
      coalesce(budget.budget_limit, 0) as budget,
      coalesce(sum(abs(transaction_row.amount)), 0) as spent
    from public.budget_categories category
    left join public.budgets budget on budget.category_id = category.id
    left join public.effective_transactions transaction_row
      on transaction_row.category_id = category.id
     and extract(year from transaction_row.date)::integer = budget.year_number
     and extract(month from transaction_row.date)::integer = budget.month_number
    where budget.year_number is not null
      and category.user_id = (select auth.uid())
      and budget.user_id = (select auth.uid())
      and budget.year_number = p_year
      and budget.month_number <= p_month
    group by category.id, budget.year_number, budget.month_number, budget.budget_limit
  ),
  with_rollover as (
    select
      cat_id,
      year_number,
      month_number,
      budget,
      spent,
      coalesce(
        sum(budget - spent) over (
          partition by cat_id
          order by month_number
          rows between unbounded preceding and 1 preceding
        ),
        0
      ) as roll
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
$$;

create or replace function public.get_spending_by_month(p_months integer default 12)
returns table(year_num integer, month_num integer, group_name text, total numeric)
language plpgsql
security invoker
set search_path = ''
as $$
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
$$;

create or replace function public.get_cash_flow(p_months integer default 12)
returns table(year_num integer, month_num integer, income numeric, expenses numeric, net numeric)
language plpgsql
security invoker
set search_path = ''
as $$
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
$$;

create or replace function public.find_duplicate_transactions()
returns table(
  id uuid,
  date date,
  description text,
  amount numeric,
  category_id uuid,
  account_id uuid,
  status text,
  not_duplicate boolean,
  duplicate_group bigint
)
language sql
security invoker
set search_path = ''
as $$
  with duplicates as (
    select
      transaction_row.id,
      transaction_row.date,
      transaction_row.description,
      transaction_row.amount,
      transaction_row.category_id,
      transaction_row.account_id,
      transaction_row.status,
      transaction_row.not_duplicate,
      dense_rank() over (
        order by transaction_row.date, transaction_row.description, transaction_row.amount
      ) as duplicate_group
    from public.transactions transaction_row
    where transaction_row.parent_id is null
      and transaction_row.user_id = (select auth.uid())
      and coalesce(transaction_row.external_status, '') <> 'removed'
  )
  select duplicate.*
  from duplicates duplicate
  where duplicate.duplicate_group in (
    select candidate.duplicate_group
    from duplicates candidate
    where candidate.not_duplicate = false
    group by candidate.duplicate_group
    having count(*) > 1
  )
  order by duplicate.duplicate_group, duplicate.date;
$$;

revoke execute on function public.get_budget_with_rollover(integer, integer) from public, anon;
revoke execute on function public.get_spending_by_month(integer) from public, anon;
revoke execute on function public.get_cash_flow(integer) from public, anon;
revoke execute on function public.find_duplicate_transactions() from public, anon;
grant execute on function public.get_budget_with_rollover(integer, integer) to authenticated;
grant execute on function public.get_spending_by_month(integer) to authenticated;
grant execute on function public.get_cash_flow(integer) to authenticated;
grant execute on function public.find_duplicate_transactions() to authenticated;
