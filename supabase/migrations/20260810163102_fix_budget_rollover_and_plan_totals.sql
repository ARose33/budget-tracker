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
$$;

revoke execute on function public.get_budget_with_rollover(integer, integer) from public, anon;
grant execute on function public.get_budget_with_rollover(integer, integer) to authenticated;
