# Proposed schema and recovery contract

These numbered SQL files are proposals, outside the applied migration directory. Only the in-memory synthetic PostgreSQL test harness has executed them. They must not be applied to an existing database without separate approval, a verified recovery point and an isolated restoration drill covering database, Auth and Storage.

## 01: preservation commands

Adds nullable archive/manual-authority/provider-lineage fields, transaction and budget revision counters, connection lease fields and an owner-isolated revision journal. Historical financial fields and relationships stay unchanged; no backfill, deletion, renaming or inferred ownership occurs. Existing unknown manual authority remains unknown and is protected by subsequent edit commands. New edits retain before/after values. Physical deletion and truncation of the seven active financial tables are blocked, including cascading deletes. Browser privileges on provider credential tables become explicit metadata-only reads.

Budget edits lock exact category/month rows, require the observed revision, preserve existing IDs and commit the complete requested list atomically. Split edits update existing allocation IDs and archive removed allocations; unsplit retains children and their parent relationship. Transaction edits validate owned references and reject stale versions.

Compatibility: old destructive split/delete/connection-cleanup clients will be rejected after this proposal. This is intentional protection, but requires a coordinated application rollout and a compatible rollback build. Shared-schema external callers and Auth deletion behavior require review before approval. Never roll back by dropping the added columns/journal or restoring a prelaunch database over newer edits.

## 02: shared financial reads

Adds one owner-isolated contribution view and pure JSON read functions for Budget, its paginated details and Analysis. Posted expense refunds reduce spending; income reversals reduce actual income. Bank-pending and Transfer activity are separate. Split allocations contribute to their own category using the parent's date/account. Archived/source-removed parents and archived allocations are excluded from active totals but retained.

Expense carry includes both surpluses and deficits across years, beginning at the first saved plan, including intervening months with no allocation. No read creates a plan. Existing source amounts are unchanged; displayed totals may differ from the defective absolute-value and year-limited calculations. USD remains the existing presentation currency; currency conversion is unsupported.

## Verification and recovery gates

Run `npm test` using synthetic fixtures. Current tests compare every original transaction field before/after the additive proposal, verify stable IDs and relationships through edits/unsplit, reject stale writes atomically and check two-user isolation. Independently calculated examples cover refunds, transfers, pending activity, carry gaps, leap days and more than 5,000 transactions with complete aggregate totals.

PGlite runs real PostgreSQL in memory but does not prove multi-session contention, deployed PostgREST behavior or complete shared-schema compatibility. Those require the isolated staging acceptance gate. Before approval, capture schema, grants, Auth and Storage inventories plus identity/relationship/field-value hashes and account/month/category totals at a frozen recovery point. Restore that point to a separately identified disposable environment and compare the inventories. Keep recovery material encrypted outside Git and screenshots.

After launch, prefer reverting application behavior with a schema-compatible build while preserving all current records and revision history. Correct a bad write by a reviewed compensating edit against its current version. A historical restore is a disaster recovery operation with reconciliation of subsequent database/Auth/Storage writes, not a routine lossless rollback.
