-- PROPOSAL ONLY: do not apply to an existing environment without separate approval.
-- No historical DML, backfill, deletion, credential change, or dropped object.
-- Validate recovery and complete shared-schema caller/grant review before rollout.
begin;

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

commit;
