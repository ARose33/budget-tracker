-- PROPOSAL ONLY. Read contracts depend on 01; no source data mutation.
begin;
create function public.stackmint_transactions(p_filters jsonb default '{}',p_page integer default 0,p_size integer default 50,p_sort text default 'date',p_desc boolean default true) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
  if p_page<0 or p_size not between 1 and 100 or p_sort not in ('date','description','amount','group','lineItem','account','status') then raise exception 'Invalid transaction page'; end if;
  with filtered as (
    select t.id,t.date,t.description,t.amount,t.category_id,t.account_id,t.status,t.categorization_status,t.is_split,t.parent_id,
      t.source,t.upload_source,t.created_at,t.plaid_transaction_id,t.not_duplicate,t.row_version,t.archived_at,t.external_status,
      case when c.id is null then null else jsonb_build_object('group_name',c.group_name,'line_item_name',c.line_item_name,'category_type',c.category_type) end as budget_categories,
      case when a.id is null then null else jsonb_build_object('name',a.name,'institution',a.institution) end as accounts,
      case p_sort when 'date' then t.date::text when 'description' then t.description when 'group' then c.group_name when 'lineItem' then c.line_item_name when 'account' then a.name when 'status' then t.categorization_status end as sort_text
    from public.transactions t
    left join public.budget_categories c on c.id=t.category_id and c.user_id=t.user_id
    left join public.accounts a on a.id=t.account_id and a.user_id=t.user_id
    where t.user_id=(select auth.uid()) and t.parent_id is null
      and (p_filters->>'id' is null or t.id=(p_filters->>'id')::uuid)
      and case coalesce(p_filters->>'history','active')
        when 'all' then true when 'archived' then t.archived_at is not null
        when 'removed' then t.external_status='removed' else t.archived_at is null and coalesce(t.external_status,'')<>'removed' end
      and (p_filters->>'search' is null or t.description ilike '%' || replace(replace(replace(p_filters->>'search','\','\\'),'%','\%'),'_','\_') || '%')
      and (p_filters->>'accountId' is null or t.account_id=(p_filters->>'accountId')::uuid)
      and (p_filters->>'status' is null or t.categorization_status=p_filters->>'status')
      and (coalesce((p_filters->>'uncategorizedOnly')::boolean,false)=false or (t.category_id is null and t.is_split is not true))
      and (p_filters->>'dateFrom' is null or t.date>=(p_filters->>'dateFrom')::date)
      and (p_filters->>'dateTo' is null or t.date<=(p_filters->>'dateTo')::date)
      and (
        (p_filters->>'categoryId' is null and p_filters->>'categoryGroup' is null and p_filters->>'categoryType' is null)
        or exists (
          select 1 from public.transactions part join public.budget_categories cat on cat.id=part.category_id and cat.user_id=part.user_id
          where part.user_id=t.user_id and part.archived_at is null
            and ((t.is_split is true and part.parent_id=t.id) or (t.is_split is not true and part.id=t.id))
            and (p_filters->>'categoryId' is null or cat.id=(p_filters->>'categoryId')::uuid)
            and (p_filters->>'categoryGroup' is null or cat.group_name=p_filters->>'categoryGroup')
            and (p_filters->>'categoryType' is null or lower(cat.category_type)=lower(p_filters->>'categoryType'))
        )
      )
  ), page as (
    select * from filtered
    order by case when p_sort='amount' and p_desc then amount end desc nulls last,
      case when p_sort='amount' and not p_desc then amount end asc nulls last,
      case when p_desc then sort_text end desc nulls last,case when not p_desc then sort_text end asc nulls last,id
    limit p_size offset p_page*p_size
  )
  select jsonb_build_object('count',(select count(*) from filtered),'data',coalesce((
    select jsonb_agg((to_jsonb(p)-'sort_text') || jsonb_build_object('notes',null,'allocations',coalesce((
      select jsonb_agg(jsonb_build_object('id',child.id,'amount',child.amount,'category_id',child.category_id,'description',child.description,
        'budget_categories',jsonb_build_object('group_name',cat.group_name,'line_item_name',cat.line_item_name,'category_type',cat.category_type)) order by child.created_at,child.id)
      from public.transactions child left join public.budget_categories cat on cat.id=child.category_id and cat.user_id=child.user_id
      where child.parent_id=p.id and child.user_id=(select auth.uid()) and child.archived_at is null
    ),'[]'))) from page p
  ),'[]')) into result;
  return result;
end;
$$;
revoke all on function public.stackmint_transactions(jsonb,integer,integer,text,boolean) from public,anon;
grant execute on function public.stackmint_transactions(jsonb,integer,integer,text,boolean) to authenticated;
commit;
