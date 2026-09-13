-- Approved StackMint v2 release. Keep all original rows and field values.
-- The runner executes this file and its history entry in one transaction.
create temporary table stackmint_release_before (
  schema_name text, table_name text, original_columns text, fingerprint jsonb
) on commit drop;
create or replace function pg_temp.stackmint_release_fingerprint(s text,t text,c text)
returns jsonb language plpgsql as $fingerprint$
declare result jsonb;
begin
  execute format('select jsonb_build_object(''rows'',count(*),''sha256'',encode(sha256(convert_to(coalesce(string_agg(h,'''' order by h),''''),''UTF8'')),''hex'')) from (select encode(sha256(convert_to(to_jsonb(r)::text,''UTF8'')),''hex'') h from (select %s from %I.%I) r) hashes',c,s,t) into result;
  return result;
end;
$fingerprint$;
do $baseline$
declare t record; columns_sql text;
begin
  for t in select n.nspname,c.relname,c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and (n.nspname in ('public','real_estate_archive_20260810','security_archive_20260810') or (n.nspname='auth' and c.relname='users') or (n.nspname='storage' and c.relname='objects'))
  loop
    select string_agg(quote_ident(attname),',' order by attnum) into columns_sql from pg_attribute where attrelid=t.oid and attnum>0 and not attisdropped;
    insert into stackmint_release_before values(t.nspname,t.relname,columns_sql,pg_temp.stackmint_release_fingerprint(t.nspname,t.relname,columns_sql));
  end loop;
end;
$baseline$;

-- 01-preservation.sql
-- No historical DML, backfill, deletion, credential change, or dropped object.
-- Validate recovery and complete shared-schema caller/grant review before rollout.

create schema if not exists stackmint_private;
revoke all on schema stackmint_private from public;
grant usage on schema stackmint_private to authenticated, service_role;

alter table public.transactions add column if not exists row_version bigint not null default 0;
alter table public.transactions add column if not exists archived_at timestamptz;
alter table public.transactions add column if not exists manual_override_fields text[];
alter table public.transactions add column if not exists provider_pending_transaction_id text;
alter table public.budgets add column if not exists row_version bigint not null default 0;
alter table public.bank_connections add column if not exists sync_lock_token uuid;
alter table public.bank_connections add column if not exists sync_lock_until timestamptz;
alter table public.bank_connections add column if not exists sync_generation bigint not null default 0;

create table public.record_revisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  entity_type text not null,
  entity_id uuid not null,
  operation_id uuid not null default gen_random_uuid(),
  prior_version bigint,
  new_version bigint,
  prior_values jsonb,
  new_values jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.record_revisions enable row level security;
revoke all on public.record_revisions from public,anon,authenticated,service_role;
create policy "Read own record history" on public.record_revisions for select to authenticated
using (user_id = (select auth.uid()));
grant select on public.record_revisions to authenticated;
grant select,insert on public.record_revisions to service_role;
create index record_revisions_entity_idx on public.record_revisions(user_id,entity_type,entity_id,created_at desc);

-- Private SECURITY DEFINER trigger only appends history after a permitted row write.
-- It has no exposed RPC and never reads or stores provider credentials.
create function stackmint_private.record_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  previous jsonb;
  current_value jsonb := to_jsonb(new);
begin
  if new.user_id is null then return new; end if;
  if tg_op = 'UPDATE' then previous := to_jsonb(old); end if;
  insert into public.record_revisions(user_id,entity_type,entity_id,prior_version,new_version,prior_values,new_values)
  values (new.user_id,tg_table_name,new.id,(previous->>'row_version')::bigint,
    (current_value->>'row_version')::bigint,previous,current_value);
  return new;
end;
$$;
revoke all on function stackmint_private.record_change() from public,anon,authenticated;

create function stackmint_private.guard_financial_row() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception using errcode='42501',message='Ownership cannot be reassigned by a financial edit';
  end if;
  if tg_table_name = 'transactions' then
    if new.category_id is not null and not exists (
      select 1 from public.budget_categories where id=new.category_id and user_id=new.user_id
    ) then raise exception using errcode='42501',message='Category is not owned by this user'; end if;
    if new.account_id is not null and not exists (
      select 1 from public.accounts where id=new.account_id and user_id=new.user_id
    ) then raise exception using errcode='42501',message='Account is not owned by this user'; end if;
    if new.parent_id is not null and not exists (
      select 1 from public.transactions where id=new.parent_id and user_id=new.user_id and parent_id is null
    ) then raise exception using errcode='42501',message='Invalid split parent'; end if;
  elsif tg_table_name='budgets' then
    if new.category_id is not null and not exists (
      select 1 from public.budget_categories where id=new.category_id and user_id=new.user_id
    ) then raise exception using errcode='42501',message='Category is not owned by this user'; end if;
  end if;
  if tg_table_name in ('transactions','budgets') then
    if tg_op='UPDATE' then new.row_version := old.row_version+1;
    else new.row_version := 0; end if;
  end if;
  return new;
end;
$$;
revoke all on function stackmint_private.guard_financial_row() from public,anon,authenticated;

create function stackmint_private.retain_financial_history() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception using errcode='42501',message='Financial history must be retained. Use an explicit archive command.';
end;
$$;
revoke all on function stackmint_private.retain_financial_history() from public,anon,authenticated;

do $$
declare target text;
begin
  foreach target in array array['accounts','budget_categories','budgets','transactions'] loop
    execute format('create trigger zz_stackmint_guard before insert or update on public.%I for each row execute function stackmint_private.guard_financial_row()',target);
    execute format('create trigger stackmint_history after insert or update on public.%I for each row execute function stackmint_private.record_change()',target);
  end loop;
  foreach target in array array['accounts','budget_categories','budgets','transactions','bank_connections','plaid_items','statement_reconciliation_reviews'] loop
    execute format('create trigger stackmint_retain before delete on public.%I for each row execute function stackmint_private.retain_financial_history()',target);
    execute format('create trigger stackmint_retain_all before truncate on public.%I for each statement execute function stackmint_private.retain_financial_history()',target);
    execute format('revoke delete,truncate,trigger,references on public.%I from anon,authenticated',target);
  end loop;
end;
$$;

-- Explicitly restrict credential-bearing tables. Current browser queries use this list.
revoke all on public.bank_connections,public.plaid_items from anon,authenticated;
grant select(id,institution_name,institution_id,last_synced_at,provider,status,error_code,error_message,user_id)
  on public.bank_connections to authenticated;
grant select(id,institution_name,created_at,user_id) on public.plaid_items to authenticated;
revoke insert,update,delete,truncate,trigger,references on public.monthly_category_stats from anon,authenticated;

create function public.stackmint_save_budgets(p_edits jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  owner_id uuid := (select auth.uid());
  edit record;
  existing public.budgets%rowtype;
  saved public.budgets%rowtype;
  result jsonb := '[]';
begin
  if owner_id is null then raise exception using errcode='42501',message='Authentication required'; end if;
  if jsonb_typeof(p_edits) is distinct from 'array' or jsonb_array_length(p_edits) not between 1 and 600 then
    raise exception 'Choose between 1 and 600 explicit budget edits';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_edits) as e(category_id uuid,year integer,month integer,budget_limit numeric,expected_version bigint)
    where category_id is null or year is null or year not between 1900 and 9998 or month is null or month not between 1 and 12
      or budget_limit is null or budget_limit < 0 or budget_limit > 9999999999999.99 or round(budget_limit,2) <> budget_limit
  ) then raise exception 'Every edit needs an owned category, valid month, and nonnegative amount with at most two decimals'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_edits) as e(category_id uuid,year integer,month integer)
    group by category_id,year,month having count(*)>1
  ) then raise exception 'A category/month appears more than once'; end if;

  perform pg_advisory_xact_lock(hashtext(owner_id::text),1101);
  for edit in select * from jsonb_to_recordset(p_edits) as e(category_id uuid,year integer,month integer,budget_limit numeric,expected_version bigint)
    order by category_id,year,month loop
    perform 1 from public.budget_categories where id=edit.category_id and user_id=owner_id;
    if not found then raise exception using errcode='42501',message='Category not found'; end if;
    select * into existing from public.budgets
      where user_id=owner_id and category_id=edit.category_id and year_number=edit.year and month_number=edit.month for update;
    if found then
      if edit.expected_version is distinct from existing.row_version then
        raise exception using errcode='40001',message='This budget changed. Reload before applying your draft.';
      end if;
      update public.budgets set budget_limit=edit.budget_limit where id=existing.id returning * into saved;
    else
      if edit.expected_version is not null then
        raise exception using errcode='40001',message='This budget changed. Reload before applying your draft.';
      end if;
      insert into public.budgets(user_id,category_id,year_number,month_number,budget_limit)
        values(owner_id,edit.category_id,edit.year,edit.month,edit.budget_limit) returning * into saved;
    end if;
    result := result || jsonb_build_array(to_jsonb(saved));
  end loop;
  return result;
end;
$$;
revoke all on function public.stackmint_save_budgets(jsonb) from public,anon;
grant execute on function public.stackmint_save_budgets(jsonb) to authenticated;

create function public.stackmint_edit_transactions(p_items jsonb,p_patch jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  owner_id uuid := (select auth.uid());
  item record;
  current_row public.transactions%rowtype;
  result jsonb := '[]';
  patch_keys text[];
begin
  if owner_id is null then raise exception using errcode='42501',message='Authentication required'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 500
    or jsonb_typeof(p_patch) is distinct from 'object' or p_patch='{}'::jsonb then raise exception 'Invalid edit'; end if;
  select array_agg(k) into patch_keys from jsonb_object_keys(p_patch) k;
  if not patch_keys <@ array['category_id','account_id','description','date','categorization_status','not_duplicate','archived'] then
    raise exception 'Unsupported transaction field';
  end if;
  if p_patch ? 'categorization_status' and coalesce(p_patch->>'categorization_status','') not in ('final','pending','uncategorized') then raise exception 'Invalid review state'; end if;
  if p_patch ? 'date' and coalesce(p_patch->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid date'; end if;
  if length(coalesce(p_patch->>'description','')) > 5000 then raise exception 'Description is too long'; end if;
  if p_patch ? 'archived' and jsonb_typeof(p_patch->'archived') is distinct from 'boolean' then raise exception 'Invalid archive state'; end if;
  if p_patch ? 'not_duplicate' and jsonb_typeof(p_patch->'not_duplicate') is distinct from 'boolean' then raise exception 'Invalid duplicate state'; end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as i(id uuid,version bigint) group by id having count(*)>1) then raise exception 'Duplicate selection'; end if;

  for item in select * from jsonb_to_recordset(p_items) as i(id uuid,version bigint) order by id loop
    select * into current_row from public.transactions where id=item.id and user_id=owner_id and parent_id is null for update;
    if not found then raise exception using errcode='42501',message='Transaction not found'; end if;
    if current_row.row_version is distinct from item.version then raise exception using errcode='40001',message='A selected transaction changed. Reload before applying your draft.'; end if;
    if current_row.is_split and p_patch ? 'category_id' then raise exception 'Edit split allocations to change categories'; end if;
    if p_patch ? 'categorization_status' and p_patch->>'categorization_status'='final'
      and current_row.category_id is null and not coalesce(current_row.is_split,false) and not (p_patch ? 'category_id' and p_patch->>'category_id' is not null) then
      raise exception 'Choose a category before marking final';
    end if;
    update public.transactions set
      category_id=case when p_patch ? 'category_id' then (p_patch->>'category_id')::uuid else category_id end,
      account_id=case when p_patch ? 'account_id' then (p_patch->>'account_id')::uuid else account_id end,
      description=case when p_patch ? 'description' then p_patch->>'description' else description end,
      date=case when p_patch ? 'date' then (p_patch->>'date')::date else date end,
      categorization_status=case when p_patch ? 'category_id' then case when p_patch->>'category_id' is null then 'uncategorized' else 'final' end
        when p_patch ? 'categorization_status' then p_patch->>'categorization_status' else categorization_status end,
      not_duplicate=case when p_patch ? 'not_duplicate' then (p_patch->>'not_duplicate')::boolean else not_duplicate end,
      archived_at=case when p_patch ? 'archived' then case when (p_patch->>'archived')::boolean then coalesce(archived_at,now()) else null end else archived_at end,
      manual_override_fields=array(select distinct unnest(coalesce(current_row.manual_override_fields,array['*']) || patch_keys))
    where id=current_row.id returning * into current_row;
    if current_row.is_split and (p_patch ? 'account_id' or p_patch ? 'date') then
      update public.transactions set account_id=current_row.account_id,date=current_row.date
        where parent_id=current_row.id and user_id=owner_id and archived_at is null;
    end if;
    result:=result || jsonb_build_array(to_jsonb(current_row));
  end loop;
  return result;
end;
$$;
revoke all on function public.stackmint_edit_transactions(jsonb,jsonb) from public,anon;
grant execute on function public.stackmint_edit_transactions(jsonb,jsonb) to authenticated;

create function public.stackmint_save_split(p_parent_id uuid,p_expected_version bigint,p_allocations jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  owner_id uuid := (select auth.uid());
  parent public.transactions%rowtype;
  allocation record;
  existing_child public.transactions%rowtype;
  ids uuid[] := '{}';
  child_id uuid;
begin
  if owner_id is null then raise exception using errcode='42501',message='Authentication required'; end if;
  select * into parent from public.transactions where id=p_parent_id and user_id=owner_id and parent_id is null
    and archived_at is null and coalesce(external_status,'')<>'removed' for update;
  if not found then raise exception using errcode='42501',message='Transaction not found'; end if;
  if parent.row_version is distinct from p_expected_version then raise exception using errcode='40001',message='This transaction changed. Reload before editing the split.'; end if;
  if jsonb_typeof(p_allocations) is distinct from 'array' or jsonb_array_length(p_allocations) not between 2 and 100 then raise exception 'Use 2 to 100 allocations'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_allocations) as a(id uuid,category_id uuid,amount numeric,description text)
    where category_id is null or amount is null or amount=0 or round(amount,2)<>amount or sign(amount)<>sign(parent.amount)
      or length(coalesce(description,''))>5000
  ) then raise exception 'Every allocation needs a category and a nonzero amount with the parent sign'; end if;
  if (select sum(amount) from jsonb_to_recordset(p_allocations) as a(amount numeric)) <> parent.amount then raise exception 'Allocations must equal the transaction amount exactly'; end if;
  if exists (select 1 from jsonb_to_recordset(p_allocations) as a(id uuid) where id is not null group by id having count(*)>1) then raise exception 'Duplicate allocation identity'; end if;

  for allocation in select * from jsonb_to_recordset(p_allocations) as a(id uuid,category_id uuid,amount numeric,description text) loop
    perform 1 from public.budget_categories where id=allocation.category_id and user_id=owner_id;
    if not found then raise exception using errcode='42501',message='Category not found'; end if;
    child_id:=coalesce(allocation.id,gen_random_uuid());
    select * into existing_child from public.transactions where id=child_id for update;
    if found then
      if existing_child.parent_id is distinct from parent.id or existing_child.user_id is distinct from owner_id then
        raise exception using errcode='42501',message='Allocation does not belong to this split';
      end if;
      update public.transactions set amount=allocation.amount,category_id=allocation.category_id,
        description=coalesce(allocation.description,parent.description),account_id=parent.account_id,date=parent.date,
        categorization_status='final',archived_at=null
        where id=child_id;
    else
      insert into public.transactions(id,user_id,parent_id,is_split,date,description,amount,category_id,account_id,
        categorization_status,source,upload_source,manual_override_fields)
      values(child_id,owner_id,parent.id,true,parent.date,coalesce(allocation.description,parent.description),allocation.amount,
        allocation.category_id,parent.account_id,'final',parent.source,parent.upload_source,array['*']);
    end if;
    ids:=array_append(ids,child_id);
  end loop;
  update public.transactions set archived_at=now()
    where parent_id=parent.id and user_id=owner_id and archived_at is null and not(id=any(ids));
  update public.transactions set is_split=true,category_id=null,categorization_status='final',
    manual_override_fields=array(select distinct unnest(coalesce(parent.manual_override_fields,array['*']) || array['category_id','is_split']))
    where id=parent.id returning * into parent;
  return to_jsonb(parent);
end;
$$;
revoke all on function public.stackmint_save_split(uuid,bigint,jsonb) from public,anon;
grant execute on function public.stackmint_save_split(uuid,bigint,jsonb) to authenticated;

create function public.stackmint_unsplit(p_parent_id uuid,p_expected_version bigint) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare owner_id uuid := (select auth.uid()); parent public.transactions%rowtype;
begin
  if owner_id is null then raise exception using errcode='42501',message='Authentication required'; end if;
  select * into parent from public.transactions where id=p_parent_id and user_id=owner_id and parent_id is null and is_split is true
    and archived_at is null and coalesce(external_status,'')<>'removed' for update;
  if not found then raise exception using errcode='42501',message='Split transaction not found'; end if;
  if parent.row_version is distinct from p_expected_version then raise exception using errcode='40001',message='This transaction changed. Reload before removing the split.'; end if;
  update public.transactions set archived_at=coalesce(archived_at,now()) where parent_id=parent.id and user_id=owner_id and archived_at is null;
  update public.transactions set is_split=false,category_id=null,categorization_status='uncategorized'
    where id=parent.id returning * into parent;
  return to_jsonb(parent);
end;
$$;
revoke all on function public.stackmint_unsplit(uuid,bigint) from public,anon;
grant execute on function public.stackmint_unsplit(uuid,bigint) to authenticated;



-- 02-finance.sql
-- PROPOSAL ONLY. Depends on 01-preservation.sql. Pure views/read functions.
-- Applying to an existing environment requires separate approval and recovery evidence.
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


-- 03-category-commands.sql
-- PROPOSAL ONLY. Depends on 01. No existing-environment execution authorized.
create function public.stackmint_category(p_command jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
#variable_conflict use_variable
declare owner_id uuid:=(select auth.uid()); category public.budget_categories%rowtype;
  action text:=p_command->>'action'; category_id uuid:=(p_command->>'id')::uuid;
  group_name text:=trim(p_command->>'group_name'); item_name text:=trim(p_command->>'line_item_name');
  category_type text:=p_command->>'category_type';
begin
  if owner_id is null then raise exception using errcode='42501',message='Authentication required'; end if;
  perform pg_advisory_xact_lock(hashtext(owner_id::text),1101);
  if action not in ('create','rename','rename_group') or action is null then raise exception 'Invalid category command'; end if;
  if group_name is null or length(group_name) not between 1 and 150 then raise exception 'Enter a group name of 1 to 150 characters'; end if;
  if action in ('create','rename') and (item_name is null or length(item_name) not between 1 and 150) then raise exception 'Enter a subcategory name of 1 to 150 characters'; end if;
  if category_type not in ('Income','Expense','income','expense') or category_type is null then raise exception 'Choose Income or Expense'; end if;
  if action='create' then
    if category_id is null then raise exception 'Missing category identity'; end if;
    select * into category from public.budget_categories where id=category_id and user_id=owner_id;
    if found then
      if category.group_name=group_name and category.line_item_name=item_name and category.category_type=category_type then return category_id; end if;
      raise exception 'Category identity already exists';
    end if;
  else
    select * into category from public.budget_categories where id=category_id and user_id=owner_id for update;
    if not found then raise exception using errcode='42501',message='Category not found'; end if;
    if category.group_name is distinct from p_command->>'expected_group'
      or category.line_item_name is distinct from p_command->>'expected_item'
      or category.category_type is distinct from category_type then
      raise exception using errcode='40001',message='This category changed. Reload before renaming.';
    end if;
  end if;
  if action='rename_group' then
    if exists(select 1 from public.budget_categories c where c.user_id=owner_id
      and lower(c.category_type)=lower(category_type) and c.group_name=group_name and c.group_name<>category.group_name) then
      raise exception 'A group with that name already exists';
    end if;
    update public.budget_categories c set group_name=group_name
      where c.user_id=owner_id and c.group_name=category.group_name and lower(c.category_type)=lower(category_type);
  else
    if exists(select 1 from public.budget_categories c where c.user_id=owner_id and c.id<>category_id
      and lower(c.category_type)=lower(category_type) and lower(trim(c.group_name))=lower(group_name) and lower(trim(c.line_item_name))=lower(item_name)) then
      raise exception 'That subcategory already exists in this group';
    end if;
    if action='create' then
      insert into public.budget_categories(id,user_id,group_name,line_item_name,category_type)
      values(category_id,owner_id,group_name,item_name,category_type);
      perform public.stackmint_save_budgets(jsonb_build_array(jsonb_build_object('category_id',category_id,
        'year',p_command->'year','month',p_command->'month','budget_limit',p_command->'budget_limit','expected_version',null)));
    else
      update public.budget_categories set group_name=group_name,line_item_name=item_name where id=category_id and user_id=owner_id;
    end if;
  end if;
  return category_id;
end;
$$;
revoke all on function public.stackmint_category(jsonb) from public,anon;
grant execute on function public.stackmint_category(jsonb) to authenticated;


-- 04-transaction-reads.sql
-- PROPOSAL ONLY. Read contracts depend on 01; no source data mutation.
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


-- 05-note-history.sql
-- PROPOSAL ONLY. Append note versions; leave every existing Storage object untouched.
create table public.transaction_note_versions(
  user_id uuid not null references auth.users(id), transaction_id uuid not null references public.transactions(id),
  version bigint not null check(version>=0), content text not null, created_at timestamptz not null default now(),
  primary key(user_id,transaction_id,version)
);
alter table public.transaction_note_versions enable row level security;
revoke all on public.transaction_note_versions from public,anon,authenticated,service_role;
create policy "Read own note history" on public.transaction_note_versions for select to authenticated using(user_id=(select auth.uid()));
grant select on public.transaction_note_versions to authenticated;
grant select,insert on public.transaction_note_versions to service_role;
create function public.stackmint_write_note(p_user_id uuid,p_transaction_id uuid,p_expected_version bigint,p_legacy_content text,p_content text)
returns bigint language plpgsql security invoker set search_path='' as $$
declare current_version bigint;
begin
  perform 1 from public.transactions where id=p_transaction_id and user_id=p_user_id for update;
  if not found then raise exception using errcode='42501',message='Transaction not found'; end if;
  if p_content is null or length(p_content)>2000 or p_legacy_content is null then raise exception 'Invalid note'; end if;
  select max(version) into current_version from public.transaction_note_versions where user_id=p_user_id and transaction_id=p_transaction_id;
  if coalesce(current_version,0) is distinct from p_expected_version then
    raise exception using errcode='40001',message='This note changed. Reload before saving.';
  end if;
  if current_version is null then
    insert into public.transaction_note_versions(user_id,transaction_id,version,content) values(p_user_id,p_transaction_id,0,p_legacy_content);
  end if;
  insert into public.transaction_note_versions(user_id,transaction_id,version,content) values(p_user_id,p_transaction_id,p_expected_version+1,p_content);
  return p_expected_version+1;
end;
$$;
revoke all on function public.stackmint_write_note(uuid,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.stackmint_write_note(uuid,uuid,bigint,text,text) to service_role;


-- 06-provider-sync.sql
-- PROPOSAL ONLY. Entire provider cycles commit atomically after all pages are fetched.
alter table public.accounts add column if not exists bank_balance_managed boolean not null default false;
alter table public.transactions add column if not exists provider_snapshot jsonb;
create table public.provider_change_reviews (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  connection_id uuid not null references public.bank_connections(id), entity_type text not null,
  entity_id uuid, provider_id text not null, proposal_hash text not null, reason text not null,
  proposed_values jsonb not null, existing_values jsonb, candidate_ids uuid[] not null default '{}',
  status text not null default 'pending' check(status in ('pending','accepted','kept')),
  created_at timestamptz not null default now(), resolved_at timestamptz,
  unique(connection_id,entity_type,provider_id,proposal_hash)
);
alter table public.provider_change_reviews enable row level security;
revoke all on public.provider_change_reviews from public,anon,authenticated,service_role;
grant select,update on public.provider_change_reviews to authenticated;
grant select,insert,update on public.provider_change_reviews to service_role;
create policy "Own provider reviews" on public.provider_change_reviews for all to authenticated
using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create index provider_reviews_pending_idx on public.provider_change_reviews(user_id,status,created_at);
create table public.sync_receipts(
  operation_id uuid primary key, user_id uuid not null references auth.users(id),
  connection_id uuid not null references public.bank_connections(id), result jsonb not null, created_at timestamptz not null default now()
);
alter table public.sync_receipts enable row level security;
revoke all on public.sync_receipts from public,anon,authenticated,service_role;
grant select on public.sync_receipts to authenticated;
grant select,insert on public.sync_receipts to service_role;
create policy "Read own sync receipts" on public.sync_receipts for select to authenticated using(user_id=(select auth.uid()));

create function public.stackmint_acquire_sync(p_connection_id uuid,p_token uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare connection public.bank_connections%rowtype;
begin
  select * into connection from public.bank_connections where id=p_connection_id and provider='plaid' and user_id is not null for update;
  if not found or connection.status not in ('active','error') then raise exception 'Connection is not available for sync'; end if;
  if p_token is null then raise exception 'Missing operation identity'; end if;
  if connection.sync_lock_token is not null and connection.sync_lock_until>now() then raise exception using errcode='55P03',message='This connection is already syncing'; end if;
  update public.bank_connections set sync_lock_token=p_token,sync_lock_until=now()+interval '90 seconds',sync_generation=sync_generation+1 where id=p_connection_id
    returning * into connection;
  return jsonb_build_object('token',p_token,'generation',connection.sync_generation,'cursor',connection.sync_cursor);
end;
$$;

create function public.stackmint_release_sync(p_connection_id uuid,p_token uuid,p_error text default null) returns void
language plpgsql security invoker set search_path='' as $$
begin
  update public.bank_connections set sync_lock_token=null,sync_lock_until=null,
    status=case when p_error is not null then 'error' else status end,
    error_code=case when p_error is not null then left(p_error,80) else error_code end,
    error_message=case when p_error is not null then 'Sync did not finish. Retry the connection; saved activity is retained.' else error_message end
  where id=p_connection_id and sync_lock_token=p_token;
end;
$$;

create function public.stackmint_apply_sync(
  p_connection_id uuid,p_token uuid,p_generation bigint,p_base_cursor text,p_next_cursor text,
  p_accounts jsonb,p_transactions jsonb,p_removed jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare connection public.bank_connections%rowtype; account_row public.accounts%rowtype; transaction_row public.transactions%rowtype;
  incoming record; local_account_id uuid; proposed jsonb; fingerprint text; candidates uuid[]; blocked_fields text[];
  changed integer:=0; removed_count integer:=0; review_count integer:=0; account_count integer:=0; result jsonb; existing_receipt jsonb;
begin
  select * into connection from public.bank_connections where id=p_connection_id for update;
  if not found or connection.sync_lock_token is distinct from p_token or connection.sync_generation is distinct from p_generation
    or connection.sync_lock_until<=now() or connection.status not in ('active','error') then
    raise exception using errcode='40001',message='Sync lease expired or was replaced';
  end if;
  select r.result into existing_receipt from public.sync_receipts r where r.operation_id=p_token and r.connection_id=p_connection_id;
  if found then return existing_receipt; end if;
  if connection.sync_cursor is distinct from p_base_cursor then raise exception using errcode='40001',message='Sync cursor changed'; end if;
  if jsonb_typeof(p_accounts) is distinct from 'array' or jsonb_array_length(p_accounts)>500
    or jsonb_typeof(p_transactions) is distinct from 'array' or jsonb_array_length(p_transactions)>50000
    or jsonb_typeof(p_removed) is distinct from 'array' or jsonb_array_length(p_removed)>50000 or p_next_cursor is null then
    raise exception 'Invalid or oversized provider cycle';
  end if;
  -- User-level serialization also prevents two connections creating the same external identity.
  perform pg_advisory_xact_lock(hashtext(connection.user_id::text),1102);
  for incoming in select * from jsonb_to_recordset(p_accounts) as a(provider_id text,name text,institution text,type text,balance numeric) loop
    if incoming.provider_id is null or incoming.name is null or round(incoming.balance,2) is distinct from incoming.balance then raise exception 'Invalid provider account'; end if;
    select * into account_row from public.accounts a where a.user_id=connection.user_id and a.connection_provider='plaid' and a.external_account_id=incoming.provider_id for update;
    if not found then
      insert into public.accounts(user_id,connection_provider,external_account_id,name,institution,type,current_balance,bank_balance_managed)
      values(connection.user_id,'plaid',incoming.provider_id,incoming.name,coalesce(incoming.institution,'Plaid'),incoming.type,incoming.balance,true);
    else
      if account_row.bank_balance_managed then
        update public.accounts set current_balance=incoming.balance,last_synced_at=now() where id=account_row.id and current_balance is distinct from incoming.balance;
      elsif account_row.current_balance is distinct from incoming.balance then
        proposed:=jsonb_build_object('current_balance',incoming.balance);
        insert into public.provider_change_reviews(user_id,connection_id,entity_type,entity_id,provider_id,proposal_hash,reason,proposed_values,existing_values)
        values(connection.user_id,connection.id,'account',account_row.id,incoming.provider_id,md5(proposed::text),'Review bank balance before replacing a historical or manual value',proposed,to_jsonb(account_row))
        on conflict do nothing;
        if found then review_count:=review_count+1; end if;
      end if;
      -- Names, types, institutions, visibility, initial values and ownership are never overwritten by sync.
    end if;
    account_count:=account_count+1;
  end loop;
  -- Pending versions first, posted versions second; explicit pending IDs preserve one logical transaction.
  for incoming in select * from jsonb_to_recordset(p_transactions) as t(provider_id text,pending_id text,account_provider_id text,date date,description text,amount numeric,pending boolean) order by pending desc loop
    if incoming.provider_id is null or incoming.date is null or incoming.amount is null or round(incoming.amount,2)<>incoming.amount or incoming.pending is null then raise exception 'Invalid provider transaction'; end if;
    select a.id into local_account_id from public.accounts a where a.user_id=connection.user_id and a.connection_provider='plaid' and a.external_account_id=incoming.account_provider_id;
    if not found then raise exception 'Provider account was not included in this cycle'; end if;
    select * into transaction_row from public.transactions t where t.user_id=connection.user_id and t.connection_provider='plaid' and t.external_transaction_id=incoming.provider_id and t.parent_id is null for update;
    if not found and incoming.pending and exists(select 1 from public.transactions t where t.user_id=connection.user_id and t.connection_provider='plaid' and t.provider_pending_transaction_id=incoming.provider_id and t.external_status='posted') then continue; end if;
    if not found and incoming.pending_id is not null then
      select * into transaction_row from public.transactions t where t.user_id=connection.user_id and t.connection_provider='plaid' and t.external_transaction_id=incoming.pending_id and t.parent_id is null for update;
    end if;
    proposed:=jsonb_build_object('account_id',local_account_id,'date',incoming.date,'description',incoming.description,'amount',incoming.amount,
      'connection_provider','plaid','external_transaction_id',incoming.provider_id,'provider_pending_transaction_id',coalesce(incoming.pending_id,transaction_row.provider_pending_transaction_id),
      'external_status',case when incoming.pending then 'pending' else 'posted' end,'source','plaid','upload_source','plaid_sync');
    fingerprint:=md5(proposed::text);
    if transaction_row.id is null then
      select array_agg(t.id) into candidates from public.transactions t
        where t.user_id=connection.user_id and t.parent_id is null and t.archived_at is null and t.not_duplicate is not true
          and coalesce(t.external_status,'') not in ('pending','removed')
          and (coalesce(t.connection_provider,'')<>'plaid' or t.external_transaction_id is null)
          and t.amount=incoming.amount and (t.account_id=local_account_id or t.account_id is null)
          and t.date between incoming.date-2 and incoming.date+2;
      if coalesce(array_length(candidates,1),0)>0 then
        insert into public.provider_change_reviews(user_id,connection_id,entity_type,provider_id,proposal_hash,reason,proposed_values,candidate_ids)
        values(connection.user_id,connection.id,'transaction',incoming.provider_id,fingerprint,'Possible existing activity; no records were linked or merged',proposed,candidates) on conflict do nothing;
        if found then review_count:=review_count+1; end if;
        continue;
      end if;
      -- A prior keep decision applies to this exact proposal only.
      if exists(select 1 from public.provider_change_reviews r where r.connection_id=connection.id and r.provider_id=incoming.provider_id and r.proposal_hash=fingerprint and r.status='kept') then continue; end if;
      insert into public.transactions(user_id,date,description,amount,account_id,connection_provider,external_transaction_id,plaid_transaction_id,
        provider_pending_transaction_id,external_status,source,upload_source,categorization_status,manual_override_fields,provider_snapshot)
      values(connection.user_id,incoming.date,incoming.description,incoming.amount,local_account_id,'plaid',incoming.provider_id,incoming.provider_id,
        incoming.pending_id,case when incoming.pending then 'pending' else 'posted' end,'plaid','plaid_sync','uncategorized','{}',proposed);
      changed:=changed+1;
    else
      blocked_fields:=coalesce(transaction_row.manual_override_fields,array['*']);
      if '*'=any(blocked_fields) then blocked_fields:=array['account_id','date','description','amount']; end if;
      if transaction_row.is_split then blocked_fields:=blocked_fields || array['amount']; end if;
      if (select count(*) from unnest(blocked_fields) as f where proposed ? f and (to_jsonb(transaction_row)->f) is distinct from proposed->f
        and (transaction_row.provider_snapshot is null or transaction_row.provider_snapshot->f is distinct from proposed->f))>0 then
        insert into public.provider_change_reviews(user_id,connection_id,entity_type,entity_id,provider_id,proposal_hash,reason,proposed_values,existing_values)
        values(connection.user_id,connection.id,'transaction',transaction_row.id,incoming.provider_id,fingerprint,'Provider changes conflict with preserved manual, historical or split fields',proposed,to_jsonb(transaction_row))
        on conflict do nothing;
        if found then review_count:=review_count+1; end if;
      end if;
      -- Store lineage and provider state, retaining source provenance, category, notes and archive state.
      proposed:=(proposed-'source'-'upload_source'-blocked_fields) || jsonb_build_object('provider_snapshot',proposed);
      if (select count(*) from jsonb_each(proposed) e where (to_jsonb(transaction_row)->e.key) is distinct from e.value)>0 then
        update public.transactions t set
          account_id=case when proposed ? 'account_id' then (proposed->>'account_id')::uuid else t.account_id end,
          date=case when proposed ? 'date' then (proposed->>'date')::date else t.date end,
          description=case when proposed ? 'description' then proposed->>'description' else t.description end,
          amount=case when proposed ? 'amount' then (proposed->>'amount')::numeric else t.amount end,
          external_transaction_id=incoming.provider_id,
          provider_pending_transaction_id=coalesce(incoming.pending_id,t.provider_pending_transaction_id),
          external_status=case when incoming.pending then 'pending' else 'posted' end,
          provider_snapshot=proposed->'provider_snapshot'
        where t.id=transaction_row.id;
        changed:=changed+1;
      end if;
    end if;
    transaction_row:=null;
  end loop;
  update public.transactions t set external_status='removed'
    where t.user_id=connection.user_id and t.connection_provider='plaid' and t.parent_id is null
      and t.external_transaction_id in (select jsonb_array_elements_text(p_removed))
      and t.external_status is distinct from 'removed';
  get diagnostics removed_count=row_count;
  result:=jsonb_build_object('accounts',account_count,'transactions',changed,'duplicatesLinked',0,'removed',removed_count,'reviews',review_count);
  insert into public.sync_receipts(operation_id,user_id,connection_id,result) values(p_token,connection.user_id,connection.id,result);
  update public.bank_connections set sync_cursor=p_next_cursor,last_synced_at=now(),status='active',error_code=null,error_message=null where id=connection.id;
  return result;
end;
$$;
revoke all on function public.stackmint_acquire_sync(uuid,uuid),public.stackmint_release_sync(uuid,uuid,text),
  public.stackmint_apply_sync(uuid,uuid,bigint,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.stackmint_acquire_sync(uuid,uuid),public.stackmint_release_sync(uuid,uuid,text),
  public.stackmint_apply_sync(uuid,uuid,bigint,text,text,jsonb,jsonb,jsonb) to service_role;


-- 07-provider-review.sql
-- PROPOSAL ONLY. Explicit review decisions and preserved connection retirement.
revoke update on public.provider_change_reviews from authenticated;
grant update(status,resolved_at) on public.provider_change_reviews to authenticated;
create trigger stackmint_provider_review_history after insert or update on public.provider_change_reviews
for each row execute function stackmint_private.record_change();

create function public.stackmint_provider_reviews(p_status text default 'pending',p_page integer default 0) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
  if p_status not in ('pending','accepted','kept') or p_page<0 then raise exception 'Invalid review page'; end if;
  with page as (
    select r.* from public.provider_change_reviews r where r.user_id=(select auth.uid()) and r.status=p_status order by created_at,id limit 20 offset p_page*20
  )
  select jsonb_build_object('count',(select count(*) from public.provider_change_reviews r where r.user_id=(select auth.uid()) and r.status=p_status),
    'rows',coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object(
      'current',case when p.entity_type='transaction' then (select to_jsonb(t) from public.transactions t where t.id=p.entity_id and t.user_id=p.user_id)
        else (select to_jsonb(a) from public.accounts a where a.id=p.entity_id and a.user_id=p.user_id) end,
      'candidates',coalesce((select jsonb_agg(to_jsonb(t)) from (select id,date,description,amount,archived_at from public.transactions where user_id=p.user_id and id=any(p.candidate_ids) order by date,id limit 50) t),'[]')
    )) from page p),'[]')) into result;
  return result;
end;
$$;
create function public.stackmint_resolve_provider_review(p_id uuid,p_decision text,p_expected_version bigint default null,p_expected_balance numeric default null) returns void
language plpgsql security invoker set search_path='' as $$
declare owner_id uuid:=(select auth.uid()); review public.provider_change_reviews%rowtype; transaction_row public.transactions%rowtype; account_row public.accounts%rowtype; proposal jsonb;
begin
  if owner_id is null then raise exception using errcode='42501',message='Authentication required'; end if;
  if p_decision is null or p_decision not in ('accept','keep') then raise exception 'Invalid decision'; end if;
  select * into review from public.provider_change_reviews where id=p_id and user_id=owner_id for update;
  if not found then raise exception using errcode='42501',message='Review not found'; end if;
  if review.status<>'pending' then
    if (p_decision='accept' and review.status='accepted') or (p_decision='keep' and review.status='kept') then return; end if;
    raise exception 'This review was already resolved';
  end if;
  proposal:=review.proposed_values;
  if p_decision='accept' then
    if review.entity_type='account' then
      select * into account_row from public.accounts where id=review.entity_id and user_id=owner_id for update;
      if not found then raise exception 'Account not found'; end if;
      if account_row.current_balance is distinct from p_expected_balance then raise exception using errcode='40001',message='The account changed. Reload this review.'; end if;
      update public.accounts set current_balance=(proposal->>'current_balance')::numeric,bank_balance_managed=true,last_synced_at=now() where id=account_row.id;
    elsif review.entity_type='transaction' and review.entity_id is not null then
      select * into transaction_row from public.transactions where id=review.entity_id and user_id=owner_id and parent_id is null for update;
      if not found then raise exception 'Transaction not found'; end if;
      if transaction_row.row_version is distinct from p_expected_version then raise exception using errcode='40001',message='The transaction changed. Reload this review.'; end if;
      if transaction_row.is_split and transaction_row.amount is distinct from (proposal->>'amount')::numeric then raise exception 'Remove or rebalance the split before accepting a different parent amount'; end if;
      update public.transactions set account_id=(proposal->>'account_id')::uuid,date=(proposal->>'date')::date,
        description=proposal->>'description',amount=(proposal->>'amount')::numeric
        where id=transaction_row.id;
      if transaction_row.is_split then
        update public.transactions set account_id=(proposal->>'account_id')::uuid,date=(proposal->>'date')::date
          where parent_id=transaction_row.id and user_id=owner_id and archived_at is null;
      end if;
    elsif review.entity_type='transaction' and review.entity_id is null then
      if exists(select 1 from public.transactions where user_id=owner_id and connection_provider='plaid' and external_transaction_id=review.provider_id) then
        raise exception using errcode='40001',message='This bank transaction is already present. Keep the current ledger.';
      end if;
      insert into public.transactions(user_id,date,description,amount,account_id,connection_provider,external_transaction_id,plaid_transaction_id,
        provider_pending_transaction_id,external_status,source,upload_source,categorization_status,manual_override_fields,provider_snapshot)
      values(owner_id,(proposal->>'date')::date,proposal->>'description',(proposal->>'amount')::numeric,(proposal->>'account_id')::uuid,
        'plaid',review.provider_id,review.provider_id,proposal->>'provider_pending_transaction_id',proposal->>'external_status',
        'plaid','plaid_sync','uncategorized','{}',proposal);
    else raise exception 'Unsupported review'; end if;
  end if;
  update public.provider_change_reviews set status=case when p_decision='accept' then 'accepted' else 'kept' end,resolved_at=now() where id=review.id;
end;
$$;

create function public.stackmint_begin_disconnect(p_connection_id uuid,p_user_id uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare connection public.bank_connections%rowtype;
begin
  select * into connection from public.bank_connections where id=p_connection_id and user_id=p_user_id and provider='plaid' for update;
  if not found then raise exception 'Connection not found'; end if;
  if connection.status='disconnected' then return false; end if;
  if connection.sync_lock_token is not null and connection.sync_lock_until>now() then raise exception using errcode='55P03',message='Wait for the current sync to finish before disconnecting'; end if;
  update public.bank_connections set status='disconnecting',sync_lock_token=null,sync_lock_until=null where id=p_connection_id;
  return true;
end;
$$;
revoke all on function public.stackmint_provider_reviews(text,integer),public.stackmint_resolve_provider_review(uuid,text,bigint,numeric),
  public.stackmint_begin_disconnect(uuid,uuid) from public,anon,authenticated;
grant execute on function public.stackmint_provider_reviews(text,integer),public.stackmint_resolve_provider_review(uuid,text,bigint,numeric) to authenticated;
grant execute on function public.stackmint_begin_disconnect(uuid,uuid) to service_role;


-- 08-categorization.sql
-- PROPOSAL ONLY. Additive run receipts; no historical writes. Requires 01.
create table public.categorization_runs (
 id uuid primary key, user_id uuid not null references auth.users(id), worker_token uuid not null,
 state text not null check (state in ('running','failed','complete')),
 lease_until timestamptz not null, candidates jsonb not null, queued_count integer not null,
 result jsonb, created_at timestamptz not null default now()
);
alter table public.categorization_runs enable row level security;
revoke all on public.categorization_runs from public,anon,authenticated,service_role;
grant select on public.categorization_runs to authenticated,service_role;
create policy "Read own categorization runs" on public.categorization_runs for select to authenticated using (user_id=(select auth.uid()));
create index categorization_runs_owner_idx on public.categorization_runs(user_id,lease_until);
create function public.stackmint_begin_categorization(p_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); run public.categorization_runs; candidates jsonb; queued integer;
begin
 if owner_id is null or p_id is null or p_token is null then raise exception 'Authentication and run identity required'; end if;
 perform pg_advisory_xact_lock(hashtext(owner_id::text),1103);
 select * into run from public.categorization_runs where id=p_id for update;
 if found and run.user_id<>owner_id then raise exception 'Run unavailable'; end if;
 if run.state='complete' then return jsonb_build_object('result',run.result); end if;
 if exists(select 1 from public.categorization_runs where user_id=owner_id and state='running' and lease_until>now()) then
  raise exception using errcode='55P03',message='A categorization batch is still running. Retry shortly.';
 end if;
 select count(*) into queued from public.transactions t where t.user_id=owner_id and t.category_id is null
 and t.categorization_status='uncategorized' and t.parent_id is null and t.is_split is not true
 and t.archived_at is null and coalesce(t.external_status,'') not in ('removed','pending');
 select coalesce(jsonb_agg(to_jsonb(c)),'[]') into candidates from (
  select t.id,t.row_version,t.description,t.amount,coalesce(a.name,'Unknown account') account_name,t.account_id
  from public.transactions t left join public.accounts a on a.id=t.account_id and a.user_id=owner_id
  where t.user_id=owner_id and t.category_id is null and t.categorization_status='uncategorized' and t.parent_id is null
  and t.is_split is not true and t.archived_at is null and coalesce(t.external_status,'') not in ('removed','pending')
  order by t.created_at nulls first,t.id limit 50
 ) c;
 insert into public.categorization_runs(id,user_id,worker_token,state,lease_until,candidates,queued_count)
 values(p_id,owner_id,p_token,'running',now()+interval '75 seconds',candidates,queued)
 on conflict(id) do update set worker_token=p_token,state='running',lease_until=now()+interval '75 seconds',candidates=excluded.candidates,queued_count=queued;
 return jsonb_build_object('candidates',candidates);
end;
$$;
create function public.stackmint_finish_categorization(p_id uuid,p_token uuid,p_items jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); run public.categorization_runs; item jsonb; candidate jsonb; row public.transactions;
 history_count integer:=0; model_count integer:=0; remaining integer; v_result jsonb;
begin
 if owner_id is null then raise exception 'Authentication required'; end if;
 select * into run from public.categorization_runs where id=p_id and user_id=owner_id for update;
 if not found then raise exception 'Run unavailable'; end if;
 if run.state='complete' then return run.result; end if;
 if run.worker_token<>p_token or run.state<>'running' or run.lease_until<=now() then raise exception 'Run lease expired; no suggestions applied'; end if;
 if p_items is null then
  update public.categorization_runs set state='failed' where id=p_id; return null;
 end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>50
 or (select count(distinct x->>'transaction_id') from jsonb_array_elements(p_items) x)<>jsonb_array_length(p_items) then raise exception 'Invalid assignments'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  select value into candidate from jsonb_array_elements(run.candidates) where value->>'id'=item->>'transaction_id';
  if candidate is null or item->>'source' is null or item->>'source' not in ('history','model') or not exists(
   select 1 from public.budget_categories where id=(item->>'category_id')::uuid and user_id=owner_id
  ) then raise exception 'Invalid assignment category or candidate'; end if;
  select * into row from public.transactions where id=(candidate->>'id')::uuid and user_id=owner_id for update;
  if not found or row.row_version<>(candidate->>'row_version')::bigint or row.category_id is not null
   or row.categorization_status<>'uncategorized' or row.archived_at is not null or row.parent_id is not null
   or row.is_split is true or coalesce(row.external_status,'') in ('removed','pending') then continue; end if;
  update public.transactions set category_id=(item->>'category_id')::uuid,categorization_status='pending' where id=row.id;
  if item->>'source'='history' then history_count:=history_count+1; else model_count:=model_count+1; end if;
 end loop;
 select count(*) into remaining from public.transactions t where t.user_id=owner_id and t.category_id is null
 and t.categorization_status='uncategorized' and t.parent_id is null and t.is_split is not true
 and t.archived_at is null and coalesce(t.external_status,'') not in ('removed','pending');
 v_result:=jsonb_build_object('processed',history_count+model_count,'matchedFromHistory',history_count,'inferredByModel',model_count,
 'skipped',jsonb_array_length(run.candidates)-history_count-model_count,'remaining',remaining,'done',remaining=0,'queuedAtStart',run.queued_count);
 update public.categorization_runs set state='complete',result=v_result where id=p_id;
 return v_result;
end;
$$;
-- Use active, posted, same-sign, unambiguous history. Historical function is retained for old callers.
create function public.stackmint_categorization_matches(p_ids uuid[]) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(m)),'[]') from (
 select t.id transaction_id,max(h.category_id::text)::uuid category_id
 from public.transactions t join public.transactions h
 on h.user_id=auth.uid() and h.account_id is not distinct from t.account_id
 and h.categorization_status='final' and h.category_id is not null and h.archived_at is null
 and h.parent_id is null and h.is_split is not true and coalesce(h.external_status,'') not in ('pending','removed')
 and sign(h.amount)=sign(t.amount)
 and lower(regexp_replace(trim(h.description),'\s+',' ','g'))=lower(regexp_replace(trim(t.description),'\s+',' ','g'))
 where t.user_id=auth.uid() and t.id=any(p_ids) and trim(t.description)<>''
 group by t.id having count(distinct h.category_id)=1
 ) m;
$$;
revoke all on function public.stackmint_begin_categorization(uuid,uuid),public.stackmint_finish_categorization(uuid,uuid,jsonb),public.stackmint_categorization_matches(uuid[]) from public,anon;
grant execute on function public.stackmint_begin_categorization(uuid,uuid),public.stackmint_finish_categorization(uuid,uuid,jsonb),public.stackmint_categorization_matches(uuid[]) to authenticated;
-- Retain the old definition/history, but prevent v1 callers bypassing version checks.
revoke execute on function public.apply_transaction_categorizations(jsonb) from public,anon,authenticated,service_role;


-- 09-reconciliation.sql
-- PROPOSAL ONLY. Preserve original review rows, decisions and full source payloads.
alter table public.statement_reconciliation_reviews add column if not exists row_version bigint not null default 0;
create function stackmint_private.guard_statement_review() returns trigger
language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-array['status','decision_note','matched_transaction_id','imported_transaction_id','reviewed_at','reviewed_by','updated_at','row_version'])
 is distinct from (to_jsonb(old)-array['status','decision_note','matched_transaction_id','imported_transaction_id','reviewed_at','reviewed_by','updated_at','row_version'])
 then raise exception 'Existing statement proposals are immutable; stage a separate review'; end if;
 if old.status<>'pending' and to_jsonb(new)-array['updated_at','row_version'] is distinct from to_jsonb(old)-array['updated_at','row_version']
 then raise exception 'Completed review decisions are preserved'; end if;
 new.row_version:=old.row_version+1; return new;
end;
$$;
create trigger stackmint_guard_statement_review before update on public.statement_reconciliation_reviews for each row execute function stackmint_private.guard_statement_review();
create trigger stackmint_record_statement_review after insert or update on public.statement_reconciliation_reviews for each row execute function stackmint_private.record_change();
revoke update on public.statement_reconciliation_reviews from public,anon,authenticated;
-- Only the owned, version-checked command may decide a review.
revoke execute on function public.resolve_statement_reconciliation_review(uuid,text,uuid,text) from public,anon,authenticated,service_role;

create function public.stackmint_reconciliation(p_filters jsonb default '{}',p_summary_only boolean default false) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare owner_id uuid:=auth.uid(); summary jsonb; items jsonb; total integer; page_number integer:=coalesce((p_filters->>'page')::integer,1);
 v_status text:=coalesce(p_filters->>'status','pending'); v_type text:=coalesce(p_filters->>'type','all');
 v_year text:=coalesce(p_filters->>'year','all'); v_account text:=coalesce(p_filters->>'account','all');
begin
 if owner_id is null then raise exception 'Authentication required'; end if;
 if page_number<1 or page_number>1000000 or v_status not in ('all','pending','matched','imported','legitimate_duplicate','ignored')
 or v_type not in ('all','proposed_import','possible_match','conflict','likely_duplicate')
 or (v_year<>'all' and v_year !~ '^[12][0-9]{3}$') then raise exception 'Invalid review filters'; end if;
 select jsonb_build_object(
 'total',count(*) filter(where status='pending'),'reviewed',count(*) filter(where status<>'pending'),'totalQueue',count(*),
 'amount',coalesce(sum(amount) filter(where status='pending'),0),
 'byType',jsonb_build_object('proposed_import',count(*) filter(where status='pending' and review_type='proposed_import'),
 'possible_match',count(*) filter(where status='pending' and review_type='possible_match'),
 'conflict',count(*) filter(where status='pending' and review_type='conflict'),
 'likely_duplicate',count(*) filter(where status='pending' and review_type='likely_duplicate')),
 'years',coalesce(jsonb_agg(distinct substring(proposed_date::text,1,4)),'[]'),
 'accounts',coalesce(jsonb_agg(distinct account_name) filter(where account_name is not null),'[]'))
 into summary from public.statement_reconciliation_reviews where user_id=owner_id;
 if p_summary_only then return jsonb_build_object('summary',summary); end if;
 select count(*) into total from public.statement_reconciliation_reviews r where r.user_id=owner_id
 and (v_status='all' or r.status=v_status) and (v_type='all' or r.review_type=v_type)
 and (v_year='all' or substring(r.proposed_date::text,1,4)=v_year) and (v_account='all' or r.account_name=v_account);
 select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('candidates',(
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'date',t.date,'amount',t.amount,'description',t.description,
 'source',t.source,'connectionProvider',t.connection_provider,'row_version',t.row_version,'archived_at',t.archived_at,'external_status',t.external_status)),'[]')
 from public.transactions t where t.user_id=owner_id and t.id=any(r.candidate_transaction_ids)
 ))),'[]') into items from (
 select * from public.statement_reconciliation_reviews r where r.user_id=owner_id
 and (v_status='all' or r.status=v_status) and (v_type='all' or r.review_type=v_type)
 and (v_year='all' or substring(r.proposed_date::text,1,4)=v_year) and (v_account='all' or r.account_name=v_account)
 order by r.proposed_date,r.created_at,r.id offset page_number-1 limit 1
 ) r;
 return jsonb_build_object('items',items,'count',total,'page',page_number,'pageSize',1,'summary',summary);
end;
$$;
create function public.stackmint_resolve_reconciliation(p_id uuid,p_version bigint,p_decision text,p_candidate_id uuid default null,p_candidate_version bigint default null,p_note text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); review public.statement_reconciliation_reviews; candidate public.transactions; transaction_id uuid; external_id text;
begin
 if owner_id is null then raise exception 'Authentication required'; end if;
 if p_decision is null or p_decision not in ('matched','imported','legitimate_duplicate','ignored') or length(coalesce(p_note,''))>20000 then raise exception 'Invalid decision'; end if;
 perform pg_advisory_xact_lock(hashtext(owner_id::text),1102);
 select * into review from public.statement_reconciliation_reviews where id=p_id and user_id=owner_id for update;
 if not found then raise exception 'Review unavailable'; end if;
 if review.status<>'pending' then
  if review.status<>p_decision or (p_decision='matched' and review.matched_transaction_id is distinct from p_candidate_id) then raise exception 'A different decision is already saved'; end if;
  return jsonb_build_object('reviewId',p_id,'status',review.status,'transactionId',coalesce(review.imported_transaction_id,review.matched_transaction_id));
 end if;
 if p_version is null or review.row_version<>p_version then raise exception 'Review changed; reload before deciding'; end if;
 if p_decision='matched' then
  if p_candidate_id is null or not(p_candidate_id=any(review.candidate_transaction_ids)) then raise exception 'Choose a listed candidate'; end if;
  select * into candidate from public.transactions where id=p_candidate_id and user_id=owner_id for update;
  if not found or p_candidate_version is null or candidate.row_version<>p_candidate_version then raise exception 'Candidate changed; reload before matching'; end if;
  if candidate.archived_at is not null or coalesce(candidate.external_status,'')='removed' or candidate.parent_id is not null then raise exception 'Restore or review inactive candidate first'; end if;
  transaction_id:=candidate.id;
 elsif p_decision='imported' then
  if review.amount is null or review.amount::text in ('NaN','Infinity','-Infinity') or abs(review.amount)>=10000000000000 or review.amount<>round(review.amount,2)
  then raise exception 'Statement amount must be finite and exact to cents'; end if;
  if not exists(select 1 from public.accounts where id=review.account_id and user_id=owner_id) then raise exception 'Mapped account unavailable'; end if;
  external_id:=nullif(trim(review.proposed_transaction->>'external_transaction_id'),'');
  if external_id is null then raise exception 'Proposal lacks an import identity; prepare a reviewed replacement'; end if;
  if coalesce(review.proposed_transaction->>'connection_provider','statement')<>'statement' then raise exception 'Only statement proposals can be imported here'; end if;
  if exists(select 1 from public.transactions where user_id=owner_id and connection_provider='statement' and external_transaction_id=external_id)
  then raise exception 'This source identity already exists; review the existing record before matching'; end if;
  insert into public.transactions(user_id,account_id,account,date,amount,description,source,upload_source,connection_provider,external_transaction_id,external_status,manual_override_fields)
  values(owner_id,review.account_id,review.account_name,review.proposed_date,review.amount,review.description,
   coalesce(review.proposed_transaction->>'source','statement'),coalesce(review.proposed_transaction->>'upload_source',review.statement_file),
   'statement',external_id,'posted',null) returning id into transaction_id;
 end if;
 update public.statement_reconciliation_reviews set status=p_decision,decision_note=nullif(trim(p_note),''),
 matched_transaction_id=case when p_decision='matched' then transaction_id else null end,
 imported_transaction_id=case when p_decision='imported' then transaction_id else null end,
 reviewed_at=now(),reviewed_by=owner_id,updated_at=now() where id=p_id;
 return jsonb_build_object('reviewId',p_id,'status',p_decision,'transactionId',transaction_id);
end;
$$;
revoke all on function public.stackmint_reconciliation(jsonb,boolean),public.stackmint_resolve_reconciliation(uuid,bigint,text,uuid,bigint,text) from public,anon;
grant execute on function public.stackmint_reconciliation(jsonb,boolean),public.stackmint_resolve_reconciliation(uuid,bigint,text,uuid,bigint,text) to authenticated;


-- 10-statement-batches.sql
-- PROPOSAL ONLY. Explicit operator commands; never part of app startup or tests against existing data.
create table public.statement_batch_receipts(
 batch_id text primary key,user_id uuid not null references auth.users(id),report_id text not null,
 result jsonb not null,created_at timestamptz not null default now()
);
alter table public.statement_batch_receipts enable row level security;
revoke all on public.statement_batch_receipts from public,anon,authenticated,service_role;
grant select on public.statement_batch_receipts to authenticated,service_role;
create policy "Read own statement batches" on public.statement_batch_receipts for select to authenticated using(user_id=(select auth.uid()));
create function public.stackmint_import_statement_batch(p_user_id uuid,p_batch_id text,p_report_id text,p_items jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item jsonb; receipt public.statement_batch_receipts; current_row public.transactions; ids jsonb:='[]'; expected jsonb:='[]'; result jsonb;
begin
 if p_user_id is null or length(coalesce(p_batch_id,'')) not between 1 and 150 or length(coalesce(p_report_id,'')) not between 1 and 150
 or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 250 then raise exception 'Invalid statement batch'; end if;
 perform pg_advisory_xact_lock(hashtext(p_user_id::text),1102);
 select * into receipt from public.statement_batch_receipts where batch_id=p_batch_id;
 if found then
  if receipt.user_id<>p_user_id or receipt.report_id<>p_report_id then raise exception 'Receipt owner/report conflict'; end if;
  return receipt.result;
 end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if item->>'amount' is null or (item->>'amount')::numeric::text in ('NaN','Infinity','-Infinity')
  or abs((item->>'amount')::numeric)>=10000000000000 or (item->>'amount')::numeric<>round((item->>'amount')::numeric,2)
  then raise exception 'Statement amount must be finite and exact to cents'; end if;
  if item->>'user_id' is distinct from p_user_id::text or coalesce(item->>'connection_provider','statement')<>'statement'
  or length(coalesce(item->>'external_transaction_id','')) not between 1 and 500
  or not exists(select 1 from public.accounts where id=(item->>'account_id')::uuid and user_id=p_user_id)
  or (item->>'category_id' is not null and not exists(select 1 from public.budget_categories where id=(item->>'category_id')::uuid and user_id=p_user_id))
  then raise exception 'Invalid import ownership or identity'; end if;
  if exists(select 1 from public.transactions where user_id=p_user_id and connection_provider='statement' and external_transaction_id=item->>'external_transaction_id')
  then raise exception 'Existing source identity requires explicit review; batch not imported'; end if;
  insert into public.transactions(user_id,account_id,account,date,amount,description,category_id,categorization_status,source,upload_source,connection_provider,external_transaction_id,external_status)
  values(p_user_id,(item->>'account_id')::uuid,item->>'account',(item->>'date')::date,(item->>'amount')::numeric,item->>'description',
  (item->>'category_id')::uuid,case when item->>'category_id' is null then 'uncategorized' else 'pending' end,
  coalesce(item->>'source','statement'),item->>'upload_source','statement',item->>'external_transaction_id','posted') returning * into current_row;
  ids:=ids||jsonb_build_array(current_row.id);
  expected:=expected||jsonb_build_array(jsonb_build_object('id',current_row.id,'version',current_row.row_version));
 end loop;
 result:=jsonb_build_object('schemaVersion',2,'batchId',p_batch_id,'reportId',p_report_id,'userId',p_user_id,
 'insertedTransactionIds',ids,'versions',expected,'inserted',jsonb_array_length(ids),'approvedRecords',p_items);
 insert into public.statement_batch_receipts(batch_id,user_id,report_id,result) values(p_batch_id,p_user_id,p_report_id,result);
 return result;
end;
$$;
create function public.stackmint_archive_statement_batch(p_user_id uuid,p_batch_id text) returns integer
language plpgsql security definer set search_path='' as $$
declare receipt public.statement_batch_receipts; item jsonb; current_row public.transactions; affected integer:=0;
begin
 perform pg_advisory_xact_lock(hashtext(p_user_id::text),1102);
 select * into receipt from public.statement_batch_receipts where batch_id=p_batch_id and user_id=p_user_id;
 if not found then raise exception 'A durable v2 receipt is required; review legacy imports individually'; end if;
 for item in select value from jsonb_array_elements(receipt.result->'versions') loop
  select * into current_row from public.transactions where id=(item->>'id')::uuid and user_id=p_user_id for update;
  if not found then raise exception 'Receipt transaction unavailable'; end if;
  if current_row.archived_at is not null then continue; end if;
  if current_row.row_version<>(item->>'version')::bigint or current_row.is_split is true
  or exists(select 1 from public.transactions where parent_id=current_row.id)
  or exists(select 1 from public.transaction_note_versions where transaction_id=current_row.id and user_id=p_user_id)
  or exists(select 1 from public.statement_reconciliation_reviews where matched_transaction_id=current_row.id or imported_transaction_id=current_row.id)
  then raise exception 'An imported record changed or gained related history; review it individually'; end if;
  update public.transactions set archived_at=now() where id=current_row.id;
  affected:=affected+1;
 end loop;
 return affected;
end;
$$;
revoke all on function public.stackmint_import_statement_batch(uuid,text,text,jsonb),public.stackmint_archive_statement_batch(uuid,text) from public,anon,authenticated;
grant execute on function public.stackmint_import_statement_batch(uuid,text,text,jsonb),public.stackmint_archive_statement_batch(uuid,text) to service_role;


-- 11-history.sql
-- PROPOSAL ONLY. Owned, paginated historical reads; no backfill or financial writes.
create function public.stackmint_transaction_history(p_id uuid,p_kind text default 'changes',p_page integer default 1) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare owner_id uuid:=auth.uid(); rows jsonb; total integer;
begin
 if owner_id is null or not exists(select 1 from public.transactions where id=p_id and user_id=owner_id) then raise exception 'Transaction unavailable'; end if;
 if p_page is null or p_page<1 or p_page>1000000 or p_kind is null or p_kind not in ('changes','notes') then raise exception 'Invalid history page'; end if;
 if p_kind='notes' then
  select count(*) into total from public.transaction_note_versions where transaction_id=p_id and user_id=owner_id;
  select coalesce(jsonb_agg(to_jsonb(n)),'[]') into rows from(
   select version,content,created_at from public.transaction_note_versions where transaction_id=p_id and user_id=owner_id
   order by version desc offset (p_page-1)*20 limit 20
  ) n;
 else
  select count(*) into total from public.record_revisions r where r.user_id=owner_id and r.entity_type='transactions'
   and (r.entity_id=p_id or r.entity_id in(select id from public.transactions where parent_id=p_id and user_id=owner_id));
  select coalesce(jsonb_agg(to_jsonb(c)),'[]') into rows from(
   select r.id,r.entity_id=p_id as original_transaction,r.created_at,r.prior_values,r.new_values from public.record_revisions r
   where r.user_id=owner_id and r.entity_type='transactions'
   and (r.entity_id=p_id or r.entity_id in(select id from public.transactions where parent_id=p_id and user_id=owner_id))
   order by r.created_at desc,r.id desc offset (p_page-1)*20 limit 20
  ) c;
 end if;
 return jsonb_build_object('rows',rows,'count',total);
end;
$$;
create function public.stackmint_legacy_connections() returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('bank',coalesce((select jsonb_agg(jsonb_build_object('id',id,'institution_name',institution_name,'provider',provider,'status',status,'last_synced_at',last_synced_at))
 from public.bank_connections where user_id=auth.uid() and provider<>'plaid'),'[]'),
 'legacy',coalesce((select jsonb_agg(jsonb_build_object('id',id,'institution_name',institution_name,'created_at',created_at))
 from public.plaid_items where user_id=auth.uid()),'[]'));
$$;
revoke all on function public.stackmint_transaction_history(uuid,text,integer),public.stackmint_legacy_connections() from public,anon;
grant execute on function public.stackmint_transaction_history(uuid,text,integer),public.stackmint_legacy_connections() to authenticated;
create function public.stackmint_categorization_counts() returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('uncategorized',count(*) filter(where categorization_status='uncategorized'),
 'pending',count(*) filter(where categorization_status='pending'),'final',count(*) filter(where categorization_status='final'),
 'eligible',count(*) filter(where categorization_status='uncategorized' and category_id is null and is_split is not true and coalesce(external_status,'')<>'pending'))
 from public.transactions where user_id=auth.uid() and parent_id is null and archived_at is null and coalesce(external_status,'')<>'removed';
$$;
revoke all on function public.stackmint_categorization_counts() from public,anon;
grant execute on function public.stackmint_categorization_counts() to authenticated;


-- 12-release-writers.sql
-- Enforce the approved coordinated rollout without modifying existing records.
create function stackmint_private.require_current_client() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  -- PostgREST sets request.method and request.headers. Direct database recovery
  -- sessions do not use this HTTP compatibility marker; RLS remains unchanged.
  if nullif(current_setting('request.method',true),'') is not null
    and coalesce(nullif(current_setting('request.headers',true),'')::jsonb ->> 'x-stackmint-version','') <> '2' then
    raise exception using errcode='42501',message='StackMint was updated. Reload the app before saving.';
  end if;
  return null;
end;
$$;
revoke all on function stackmint_private.require_current_client() from public,anon,authenticated,service_role;
do $$
declare target text;
begin
  foreach target in array array['accounts','budget_categories','budgets','transactions','bank_connections','statement_reconciliation_reviews'] loop
    execute format('create trigger aa_stackmint_current_client before insert or update or delete on public.%I for each statement execute function stackmint_private.require_current_client()',target);
  end loop;
end;
$$;

-- V2 writes notes to immutable database versions. Legacy Storage files remain
-- readable, and an old server deployment cannot overwrite them after rollout.
create function stackmint_private.retain_legacy_note_file() returns trigger
language plpgsql security invoker set search_path='' as $$
declare bucket text;
begin
  if tg_op='DELETE' then bucket := old.bucket_id; else bucket := new.bucket_id; end if;
  if bucket='transaction-notes' or (tg_op='UPDATE' and old.bucket_id='transaction-notes') then
    raise exception using errcode='42501',message='StackMint was updated. Reload the app to save a versioned note.';
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function stackmint_private.retain_legacy_note_file() from public,anon,authenticated,service_role;
do $$
begin
  if to_regclass('storage.objects') is not null then
    create trigger stackmint_retain_legacy_notes before insert or update or delete on storage.objects
      for each row execute function stackmint_private.retain_legacy_note_file();
  end if;
end;
$$;

do $preserved$
declare original record;
begin
  for original in select * from stackmint_release_before loop
    if pg_temp.stackmint_release_fingerprint(original.schema_name,original.table_name,original.original_columns) is distinct from original.fingerprint then
      raise exception 'Release cancelled: an original row or field changed';
    end if;
  end loop;
  if exists(select 1 from public.record_revisions) then
    raise exception 'Release cancelled: fabricated historical revisions';
  end if;
end;
$preserved$;
notify pgrst, 'reload schema';
