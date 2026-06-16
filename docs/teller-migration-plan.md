# Teller Migration Plan

## Pricing Decision

Teller's published Developer tier is free for independent developers and teams
prototyping ideas, and it includes 100 live connections. Based on that published
limit, this app should stay free if the connected bank-login count remains at or
below 100 live connections.

Important caveat: Teller describes the free tier in terms of live connections,
not local app accounts. A single bank login may expose multiple accounts. Before
turning on production sync, confirm the expected number of connected
institutions/logins in the Teller dashboard.

Sources checked May 26, 2026:

- https://teller.io/
- https://teller.io/docs/api

## Current App State

- Accounts are stored in Supabase through `src/lib/queries/accounts.ts`.
- Transactions are stored in Supabase through `src/lib/queries/transactions.ts`.
- The current schema still contains Plaid-shaped fields:
  - `accounts.plaid_account_id`
  - `transactions.plaid_transaction_id`
  - `plaid_items`
- The live implementation stores Teller IDs in those legacy columns with a
  `teller:` prefix so it works before the provider-neutral migration is applied.
- CSV import is the current transaction ingestion path and should remain as a
  fallback.

## Recommended Schema Direction

Prefer provider-neutral columns instead of replacing Plaid names with Teller
names everywhere:

- `accounts.connection_provider` text, for example `manual`, `csv`, `teller`
- `accounts.external_account_id` text
- `transactions.connection_provider` text
- `transactions.external_transaction_id` text
- A provider connection table such as `bank_connections` with:
  - `id`
  - `provider`
  - `provider_enrollment_id`
  - encrypted or server-side reference to provider access token material
  - `institution_name`
  - `last_synced_at`
  - `status`

This keeps the app from being locked to a second provider-specific schema if
Teller changes pricing or coverage later.

## Implementation Steps

1. Add Teller environment variables, keeping secrets server-only:
   - `TELLER_APPLICATION_ID`
   - `TELLER_ENVIRONMENT`
   - Teller certificate/key material if required by the selected auth setup
2. Use the existing schema immediately:
   - Teller enrollments are stored in `plaid_items` with `item_id =
     teller:<enrollment_id>`.
   - Teller accounts are stored with `accounts.plaid_account_id =
     teller:<account_id>`.
   - Teller transactions are stored with `transactions.plaid_transaction_id =
     teller:<transaction_id>`.
3. Add Next App Router route handlers under `src/app/api/teller/*/route.ts`.
4. Add a server-only Teller client module for:
   - account listing
   - balances
   - transactions
   - webhook handling or manual sync
5. Add Supabase migrations for provider-neutral account and transaction IDs.
6. Add Accounts page actions:
   - connect with Teller
   - sync all Teller accounts
   - show provider/sync status
7. Map Teller transactions into existing budget workflow:
   - preserve duplicate detection
   - default new synced transactions to `Unconfirmed`
   - keep CSV import as a fallback
8. Add rate-limit handling:
   - back off on HTTP 429
   - avoid repeated sync loops
   - make sync idempotent by external transaction ID

## Open Questions

- How many bank logins/institutions will be connected?
- Should sync run only on demand, or should it run on a schedule?
- Should existing Plaid-linked rows be migrated in place, or left as historical
  provider-specific data?
