-- PROPOSAL ONLY. Entire provider cycles commit atomically after all pages are fetched.
begin;
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
commit;
