-- PROPOSAL ONLY. Append note versions; leave every existing Storage object untouched.
begin;
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
commit;
