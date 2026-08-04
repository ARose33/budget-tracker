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
    and transaction_row.category_id is null
    and transaction_row.date >= make_date(p_year, p_month, 1)
    and transaction_row.date < (
      make_date(p_year, p_month, 1) + interval '1 month'
    )::date;
$$;

revoke execute on function public.get_monthly_uncategorized_summary(integer, integer)
  from public, anon;
grant execute on function public.get_monthly_uncategorized_summary(integer, integer)
  to authenticated;
