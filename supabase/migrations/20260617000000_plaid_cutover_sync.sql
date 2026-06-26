alter table public.bank_connections
  add column if not exists sync_cursor text,
  add column if not exists institution_id text,
  add column if not exists error_code text,
  add column if not exists error_message text,
  add column if not exists last_webhook_at timestamptz;

drop index if exists public.bank_connections_provider_enrollment_id_key;
create unique index if not exists bank_connections_provider_enrollment_user_key
  on public.bank_connections (provider, provider_enrollment_id, user_id);

drop index if exists public.transactions_provider_external_transaction_id_key;
create unique index if not exists transactions_provider_external_transaction_user_key
  on public.transactions (connection_provider, external_transaction_id, user_id)
  where external_transaction_id is not null;
