-- PROPOSAL ONLY. Preserve original review rows, decisions and full source payloads.
begin;
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
commit;
