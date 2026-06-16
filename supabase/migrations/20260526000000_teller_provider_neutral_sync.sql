alter table public.accounts
  add column if not exists connection_provider text not null default 'manual',
  add column if not exists external_account_id text;

alter table public.transactions
  add column if not exists connection_provider text not null default 'manual',
  add column if not exists external_transaction_id text,
  add column if not exists external_status text;

create table if not exists public.bank_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_enrollment_id text not null,
  access_token text not null,
  institution_name text,
  status text not null default 'active',
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid
);

create unique index if not exists bank_connections_provider_enrollment_id_key
  on public.bank_connections (provider, provider_enrollment_id);

create unique index if not exists accounts_provider_external_account_id_key
  on public.accounts (connection_provider, external_account_id);

create unique index if not exists transactions_provider_external_transaction_id_key
  on public.transactions (connection_provider, external_transaction_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists bank_connections_set_updated_at on public.bank_connections;

create trigger bank_connections_set_updated_at
before update on public.bank_connections
for each row
execute function public.set_updated_at();
