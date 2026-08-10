create index statement_reconciliation_reviews_account_idx
  on public.statement_reconciliation_reviews (account_id);
create index statement_reconciliation_reviews_matched_transaction_idx
  on public.statement_reconciliation_reviews (matched_transaction_id)
  where matched_transaction_id is not null;
create index statement_reconciliation_reviews_imported_transaction_idx
  on public.statement_reconciliation_reviews (imported_transaction_id)
  where imported_transaction_id is not null;
create index statement_reconciliation_reviews_reviewed_by_idx
  on public.statement_reconciliation_reviews (reviewed_by)
  where reviewed_by is not null;
