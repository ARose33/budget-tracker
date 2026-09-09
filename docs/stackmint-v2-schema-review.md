# Proposed schema and recovery contract

These numbered SQL files are proposals, outside the applied migration directory. Only the in-memory synthetic PostgreSQL test harness has executed them. They must not be applied to an existing database without separate approval, a verified recovery point and an isolated restoration drill covering database, Auth and Storage.

## 01: preservation commands

Adds nullable archive/manual-authority/provider-lineage fields, transaction and budget revision counters, connection lease fields and an owner-isolated revision journal. Historical financial fields and relationships stay unchanged; no backfill, deletion, renaming or inferred ownership occurs. Existing unknown manual authority remains unknown and is protected by subsequent edit commands. New edits retain before/after values. Physical deletion and truncation of the seven active financial tables are blocked, including cascading deletes. Browser privileges on provider credential tables become explicit metadata-only reads.

Budget edits lock exact category/month rows, require the observed revision, preserve existing IDs and commit the complete requested list atomically. Split edits update existing allocation IDs and archive removed allocations; unsplit retains children and their parent relationship. Transaction edits validate owned references and reject stale versions.

Compatibility: old destructive split/delete/connection-cleanup clients will be rejected after this proposal. This is intentional protection, but requires a coordinated application rollout and a compatible rollback build. Shared-schema external callers and Auth deletion behavior require review before approval. Never roll back by dropping the added columns/journal or restoring a prelaunch database over newer edits.

## 02: shared financial reads

Adds one owner-isolated contribution view and pure JSON read functions for Budget, its paginated details and Analysis. Posted expense refunds reduce spending; income reversals reduce actual income. Bank-pending and Transfer activity are separate. Split allocations contribute to their own category using the parent's date/account. Archived/source-removed parents and archived allocations are excluded from active totals but retained.

Expense carry includes both surpluses and deficits across years, beginning at the first saved plan, including intervening months with no allocation. No read creates a plan. Existing source amounts are unchanged; displayed totals may differ from the defective absolute-value and year-limited calculations. USD remains the existing presentation currency; currency conversion is unsupported.

## 03–05: category, transaction and note contracts

03 adds an atomic category command. A new category and its one selected-month plan commit together; retrying its identity cannot duplicate it. Renaming checks observed names and preserves IDs, references and plan amounts. Group names apply globally and the UI states this explicitly.

04 adds owner-filtered transaction search/pagination with split membership evaluated in SQL, avoiding a capped intermediate list of parent IDs. Active, all-history, archived and source-removed filters retain access to existing records.

05 adds an append-only transaction_note_versions table with owner SELECT and service SELECT/INSERT grants, explicitly revoking inherited default privileges. The API checks the loaded revision and content hash, locks the owned transaction, preserves the read legacy text as version zero, then appends new text or an explicit empty version. Existing Storage objects remain untouched. Old clients that write directly to the legacy Storage location must be quiesced at rollout; two different stores cannot provide an atomic compare-and-swap against an unmodified v1 writer. Rollback clients must read the newest note version before falling back to legacy Storage.

## 06–07: provider cycles and explicit conflict review

06 adds a last-observed provider snapshot to transactions, an explicit bank-managed balance flag (false for existing accounts), owner-isolated provider review items and immutable sync receipts. Existing records are not backfilled or inferred. Service-only lease/commit functions lock one connection, fence expired workers and atomically apply a fully fetched cycle with its cursor and receipt. Provider snapshots contain normalized transaction fields, never tokens. New bank-managed rows can receive provider field updates; historical unknown/manual fields and split amounts are protected. Names, types, categories, source provenance, initial values and visibility are retained. Explicit pending identifiers preserve the logical transaction ID when it posts; superseded pending replays cannot create duplicates.

Potential cross-source duplicates are queued without merging or linking records. Confirmed not-duplicate flags are respected. 07 makes pending, accepted and kept reviews accessible, with explicit decisions and current-value/version checks. Choosing a bank balance explicitly enables later bank balance refreshes for that account. Connection retirement only changes connection state and calls the provider after the in-app user action; it does not hide accounts, remove transactions, delete connection records or clear tokens. A failed or ambiguous disconnect pauses automatic sync and keeps a retryable record.

The application stages provider pages in process memory (at most 100 pages and 50,000 changes), retries pagination mutations from the original cursor and makes no financial write before the final page. The limit fails visibly with the ledger/cursor unchanged; staging performance and host request duration remain rollout gates. Lost commit responses can be recovered from their receipt. PostgreSQL tests exercise stale/overlapping leases and rollback; true multi-session contention is still a staging gate. This follows the provider's [pagination restart contract](https://plaid.com/docs/api/products/transactions/#transactionssync).

## Verification and recovery gates

Run `npm test` using synthetic fixtures. Current tests compare every original transaction field before/after the additive proposal, verify stable IDs and relationships through edits/unsplit, reject stale writes atomically and check two-user isolation. Independently calculated examples cover refunds, transfers, pending activity, carry gaps, leap days and more than 5,000 transactions with complete aggregate totals.

PGlite runs real PostgreSQL in memory but does not prove multi-session contention, deployed PostgREST behavior or complete shared-schema compatibility. Those require the isolated staging acceptance gate. Before approval, capture schema, grants, Auth and Storage inventories plus identity/relationship/field-value hashes and account/month/category totals at a frozen recovery point. Restore that point to a separately identified disposable environment and compare the inventories. Keep recovery material encrypted outside Git and screenshots.

After launch, prefer reverting application behavior with a schema-compatible build while preserving all current records and revision history. Correct a bad write by a reviewed compensating edit against its current version. A historical restore is a disaster recovery operation with reconciliation of subsequent database/Auth/Storage writes, not a routine lossless rollback.

## Proposal 08: categorization batches

Creates owner-readable, function-managed categorization_runs with bounded candidate snapshots, worker leases and immutable completed results. New begin/finish functions isolate users and atomically save suggestions only at observed transaction versions; a history function excludes inactive and opposite-sign examples. No historical rows are changed. The former apply RPC remains defined but its execution is revoked to prevent old clients bypassing version checks. Code rollback must use the compatible v2 commands; quiesce old tabs and automation at rollout. Synthetic PostgreSQL verifies partial-failure rollback, stale workers, receipt retries and two-user isolation. No OpenAI calls were made.
