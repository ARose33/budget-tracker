alter table public.plaid_items
  add column if not exists user_id uuid;

alter table public.accounts enable row level security;
alter table public.budget_categories enable row level security;
alter table public.budgets enable row level security;
alter table public.transactions enable row level security;
alter table public.plaid_items enable row level security;
alter table public.bank_connections enable row level security;

drop policy if exists "Users can manage their accounts" on public.accounts;
create policy "Users can manage their accounts"
  on public.accounts
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Users can manage their budget categories" on public.budget_categories;
create policy "Users can manage their budget categories"
  on public.budget_categories
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Users can manage their budgets" on public.budgets;
create policy "Users can manage their budgets"
  on public.budgets
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Users can manage their transactions" on public.transactions;
create policy "Users can manage their transactions"
  on public.transactions
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Users can manage their bank items" on public.plaid_items;
create policy "Users can manage their bank items"
  on public.plaid_items
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Users can manage their bank connections" on public.bank_connections;
create policy "Users can manage their bank connections"
  on public.bank_connections
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
