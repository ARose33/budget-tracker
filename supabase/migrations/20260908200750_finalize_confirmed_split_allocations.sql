update public.transactions
set categorization_status = 'final'
where status = 'Confirmed'
  and categorization_status <> 'final';
