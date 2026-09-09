-- PROPOSAL ONLY. Owned, paginated historical reads; no backfill or financial writes.
begin;
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
commit;
