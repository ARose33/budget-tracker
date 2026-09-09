-- PROPOSAL ONLY. Depends on 01-preservation.sql. Pure views/read functions.
-- Applying to an existing environment requires separate approval and recovery evidence.
begin;
create view public.stackmint_contributions with (security_invoker=true) as
with active as (
  select t.id,t.id as parent_transaction_id,t.parent_id,t.date,t.description,t.amount,t.amount as parent_amount,
    t.category_id,t.account_id,t.user_id,t.categorization_status,t.external_status,t.row_version,t.row_version as allocation_version,
    false as allocation
  from public.transactions t
  where t.user_id=(select auth.uid()) and t.parent_id is null and t.is_split is not true
    and t.archived_at is null and coalesce(t.external_status,'')<>'removed'
  union all
  select a.id,p.id,a.parent_id,p.date,coalesce(a.description,p.description),a.amount,p.amount,
    a.category_id,p.account_id,p.user_id,p.categorization_status,p.external_status,p.row_version,a.row_version,true
  from public.transactions a join public.transactions p on p.id=a.parent_id and p.user_id=a.user_id
  where p.user_id=(select auth.uid()) and p.parent_id is null and p.is_split is true
    and p.archived_at is null and a.archived_at is null and coalesce(p.external_status,'')<>'removed'
)
select a.*,c.group_name,c.line_item_name,lower(c.category_type) as category_type,
  coalesce(ac.name,'Unknown account') as account_name,
  coalesce(a.external_status='pending',false) as is_pending,
  case when lower(c.category_type)='expense' then -a.amount else a.amount end as contribution
from active a
left join public.budget_categories c on c.id=a.category_id and c.user_id=a.user_id
left join public.accounts ac on ac.id=a.account_id and ac.user_id=a.user_id;
grant select on public.stackmint_contributions to authenticated;
revoke all on public.stackmint_contributions from anon;

create function public.stackmint_budget(p_year integer,p_month integer) returns jsonb
language sql stable security invoker set search_path='' as $$
with period as (
  select make_date(p_year,p_month,1) as start_date,(make_date(p_year,p_month,1)+interval '1 month')::date as end_date
), plans as (
  select b.category_id,
    min(make_date(b.year_number,b.month_number,1)) as first_month,
    coalesce(sum(b.budget_limit) filter(where make_date(b.year_number,b.month_number,1)<p.start_date),0) as prior_budget
  from public.budgets b cross join period p where b.user_id=(select auth.uid())
  group by b.category_id
), amounts as (
  select t.category_id,
    coalesce(sum(t.contribution) filter(where t.date>=p.start_date and not t.is_pending),0) as spent,
    coalesce(sum(t.contribution) filter(where t.date>=p.start_date and t.is_pending),0) as pending,
    coalesce(sum(t.contribution) filter(where t.date<p.start_date and t.date>=b.first_month and not t.is_pending),0) as prior_spent,
    count(distinct t.parent_transaction_id) filter(where t.date>=p.start_date and not t.is_pending) as transaction_count,
    count(distinct t.parent_transaction_id) filter(where t.date>=p.start_date and not t.is_pending and t.categorization_status='pending') as review_count
  from public.stackmint_contributions t cross join period p left join plans b on b.category_id=t.category_id
  where t.date<p.end_date group by t.category_id
), rows as (
  select c.id as category_id,c.group_name,c.line_item_name,c.category_type,
    b.id as budget_id,b.row_version,b.id is not null as has_budget,
    coalesce(b.budget_limit,0) as budget_limit,coalesce(a.spent,0) as actual_spent,coalesce(a.pending,0) as pending_spent,
    case when lower(c.category_type)='expense' then coalesce(pl.prior_budget,0)-coalesce(a.prior_spent,0) else 0 end as rollover,
    coalesce(b.budget_limit,0)+case when lower(c.category_type)='expense' then coalesce(pl.prior_budget,0)-coalesce(a.prior_spent,0) else 0 end as effective_budget,
    coalesce(a.transaction_count,0) as transaction_count,coalesce(a.review_count,0) as review_count
  from public.budget_categories c
  left join public.budgets b on b.category_id=c.id and b.user_id=c.user_id and b.year_number=p_year and b.month_number=p_month
  left join plans pl on pl.category_id=c.id left join amounts a on a.category_id=c.id
  where c.user_id=(select auth.uid()) and lower(c.category_type) in ('income','expense')
), attention as (
  select count(distinct t.parent_transaction_id) filter(where t.category_id is null and not t.is_pending) as uncategorized_count,
    coalesce(-sum(t.amount) filter(where t.category_id is null and not t.is_pending and t.amount<0),0) as uncategorized_outflow,
    coalesce(sum(t.amount) filter(where t.category_id is null and not t.is_pending and t.amount>0),0) as uncategorized_inflow,
    count(distinct t.parent_transaction_id) filter(where t.is_pending and coalesce(t.category_type,'')<>'transfer') as pending_count,
    coalesce(sum(t.contribution) filter(where t.is_pending and t.category_type='expense'),0) as pending_expenses,
    coalesce(sum(t.contribution) filter(where t.is_pending and t.category_type='income'),0) as pending_income,
    count(distinct t.parent_transaction_id) filter(where not t.is_pending and t.categorization_status='pending') as review_count,
    count(distinct t.parent_transaction_id) filter(where t.category_type='transfer') as transfer_count
  from public.stackmint_contributions t cross join period p where t.date>=p.start_date and t.date<p.end_date
), months as (
  select distinct b.year_number as year,b.month_number as month from public.budgets b where b.user_id=(select auth.uid())
)
select jsonb_build_object(
  'items',coalesce((select jsonb_agg(to_jsonb(r) order by r.category_type,r.group_name,r.line_item_name,r.category_id) from rows r),'[]'),
  'attention',(select to_jsonb(a) from attention a),
  'months',coalesce((select jsonb_agg(to_jsonb(m) order by m.year desc,m.month desc) from months m),'[]')
);
$$;
revoke all on function public.stackmint_budget(integer,integer) from public,anon;
grant execute on function public.stackmint_budget(integer,integer) to authenticated;

create function public.stackmint_budget_activity(
  p_year integer,p_month integer,p_category_id uuid default null,p_filter text default 'booked',
  p_offset integer default 0,p_limit integer default 50
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; start_date date := make_date(p_year,p_month,1); end_date date := (start_date+interval '1 month')::date;
begin
  if p_filter not in ('booked','pending','uncategorized','review','all') or p_offset<0 or p_limit not between 1 and 100 then raise exception 'Invalid activity scope'; end if;
  with filtered as (
    select t.* from public.stackmint_contributions t
    where t.date>=start_date and t.date<end_date and (p_category_id is null or t.category_id=p_category_id)
      and case p_filter
        when 'booked' then not t.is_pending
        when 'pending' then t.is_pending and coalesce(t.category_type,'')<>'transfer'
        when 'uncategorized' then t.category_id is null and not t.is_pending
        when 'review' then t.categorization_status='pending' and not t.is_pending
        else true end
  ), page as (
    select * from filtered order by date desc,parent_transaction_id,id limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(to_jsonb(p) order by p.date desc,p.parent_transaction_id,p.id) from page p),'[]'),
    'count',(select count(*) from filtered),
    'total',(select coalesce(sum(contribution),0) from filtered),
    'outflow',(select coalesce(-sum(amount) filter(where amount<0),0) from filtered),
    'inflow',(select coalesce(sum(amount) filter(where amount>0),0) from filtered)
  ) into result;
  return result;
end;
$$;
revoke all on function public.stackmint_budget_activity(integer,integer,uuid,text,integer,integer) from public,anon;
grant execute on function public.stackmint_budget_activity(integer,integer,uuid,text,integer,integer) to authenticated;

create function public.stackmint_analysis(p_from date,p_to date) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
  if p_from is null or p_to is null or p_to<=p_from or p_to>p_from+interval '20 years' then raise exception 'Choose a valid analysis period of at most 20 years'; end if;
  with activity as (
    select * from public.stackmint_contributions where date>=p_from and date<p_to and not is_pending
  ), categories as (
    select extract(year from date)::integer as year_num,extract(month from date)::integer as month_num,
      category_id,group_name,line_item_name,category_type,sum(contribution) as total
    from activity where category_type in ('income','expense') group by 1,2,3,4,5,6
  ), groups as (
    select year_num,month_num,group_name,sum(total) as total from categories where category_type='expense' group by 1,2,3
  ), flow as (
    select year_num,month_num,
      coalesce(sum(total) filter(where category_type='income'),0) as income,
      coalesce(sum(total) filter(where category_type='expense'),0) as expenses,
      coalesce(sum(total) filter(where category_type='income'),0)-coalesce(sum(total) filter(where category_type='expense'),0) as net
    from categories group by 1,2
  ), movements as (
    select extract(year from date)::integer as year_num,extract(month from date)::integer as month_num,
      coalesce(sum(amount) filter(where amount>0),0) as income,coalesce(-sum(amount) filter(where amount<0),0) as expenses,sum(amount) as net
    from public.transactions where user_id=(select auth.uid()) and parent_id is null and archived_at is null
      and coalesce(external_status,'') not in ('pending','removed') and date>=p_from and date<p_to group by 1,2
  )
  select jsonb_build_object(
    'groups',coalesce((select jsonb_agg(to_jsonb(g) order by g.year_num,g.month_num,g.group_name) from groups g),'[]'),
    'categories',coalesce((select jsonb_agg(to_jsonb(c) order by c.year_num,c.month_num,c.category_id) from categories c),'[]'),
    'flow',coalesce((select jsonb_agg(to_jsonb(f) order by f.year_num,f.month_num) from flow f),'[]'),
    'movements',coalesce((select jsonb_agg(to_jsonb(m) order by m.year_num,m.month_num) from movements m),'[]')
  ) into result;
  return result;
end;
$$;
revoke all on function public.stackmint_analysis(date,date) from public,anon;
grant execute on function public.stackmint_analysis(date,date) to authenticated;
commit;
