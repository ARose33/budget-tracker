-- Enforce the approved coordinated rollout without modifying existing records.
begin;
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
commit;
