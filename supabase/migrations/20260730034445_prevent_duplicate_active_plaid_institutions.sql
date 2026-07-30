create unique index if not exists bank_connections_active_plaid_institution_user_key
  on public.bank_connections (user_id, institution_id)
  where provider = 'plaid'
    and status = 'active'
    and user_id is not null
    and institution_id is not null;
