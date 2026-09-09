-- PROPOSAL ONLY. Additive run receipts; no historical writes. Requires 01.
begin;
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
commit;
