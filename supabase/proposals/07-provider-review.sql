-- PROPOSAL ONLY. Explicit review decisions and preserved connection retirement.
begin;
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
commit;
