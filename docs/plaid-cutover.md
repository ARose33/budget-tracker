# Plaid Cutover

The app now uses Plaid Link and Plaid Transactions Sync for connected bank
accounts. The previous bank-link provider code, routes, and UI have been
removed.

## Runtime Flow

- The Accounts page creates a Plaid Link token through
  `POST /api/plaid/link-token`.
- Plaid Link returns a `public_token`, which is exchanged through
  `POST /api/plaid/exchange-public-token`.
- Plaid Items are stored in `bank_connections` with `provider = 'plaid'`.
- Plaid accounts are stored in `accounts` with
  `connection_provider = 'plaid'` and `external_account_id = account_id`.
- Plaid transactions are stored in `transactions` with
  `connection_provider = 'plaid'` and
  `external_transaction_id = transaction_id`.

## Sync Behavior

- Link tokens request 730 days of transaction history.
- The app syncs immediately after Link succeeds.
- Plaid transaction webhooks call `POST /api/plaid/webhook`.
- The Vercel cron calls `/api/plaid/cron-sync` daily as a backup.
- Transactions Sync cursors are saved only after the paginated sync completes.

## Duplicate Protection

Existing imported transactions are reconciled before inserting Plaid rows. A
Plaid transaction is linked to an existing transaction when the amount matches,
the date is within two days, and the normalized description/account signals are
strong enough. Linked rows keep user-entered categorization and status.

Weak matches are inserted as new `Unconfirmed` transactions so the app's
duplicate review workflow can surface them.

## Required Environment

```env
PLAID_CLIENT_ID=
PLAID_SECRET=
PLAID_ENV=sandbox
PLAID_WEBHOOK_SECRET=
PLAID_SYNC_CRON_SECRET=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SITE_URL=
```
