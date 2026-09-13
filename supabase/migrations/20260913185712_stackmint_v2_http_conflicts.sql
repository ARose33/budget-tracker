-- PostgREST 14 retries SQLSTATE 40001 indefinitely. Business conflicts must
-- return HTTP 409 without retrying the same stale command. No records change.
-- https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b
do $conflicts$
declare routine record; changed integer := 0;
begin
  for routine in
    select p.oid,p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f' and p.proname in (
      'stackmint_save_budgets','stackmint_edit_transactions','stackmint_save_split',
      'stackmint_unsplit','stackmint_category','stackmint_write_note',
      'stackmint_apply_sync','stackmint_resolve_provider_review'
    )
  loop
    if position('errcode=''40001''' in routine.prosrc) = 0 then
      raise exception 'Unexpected release function contract';
    end if;
    execute replace(pg_get_functiondef(routine.oid),'errcode=''40001''','errcode=''PT409''');
    changed := changed+1;
  end loop;
  if changed <> 8 then raise exception 'Incomplete release conflict correction'; end if;
end;
$conflicts$;
notify pgrst, 'reload schema';
