-- PROPOSAL ONLY. Explicit operator commands; never part of app startup or tests against existing data.
begin;
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
commit;
