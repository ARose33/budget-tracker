# Operator tools and existing data

These commands are retained because external/operator callers are uncertain. They are never test, installation, startup, preview or deployment commands.

## Existing-data authorization

Read commands require --allow-existing-data-read. Write commands require --approved-change-plan=<path> before reading environment credentials. The JSON is a record of a separately approved operation, not permission invented by a script or agent. It must contain nonempty operation, authorizationReference, recoveryReference, restoreVerificationReference, targetUrl, userId and scope. The operation and configured URL must match; supported owner checks must match as well. Do not create an approval file without the user's authorization and actual restore evidence. Keep it outside Git with the private reports.

Operation names: statements:apply, statements:rollback, statements:seed-review, csv-import, merge-accounts, retire-connection. Existing manifest fingerprints and batch approval tokens remain additional checks. A fingerprint is not evidence that the user approved an operation.

These separate statement/CSV/account-maintenance operations are outside the authorized v2 publication. The approved release schema is packaged in `20260913184110_stackmint_v2_release.sql`; recovery and rollout evidence is in `stackmint-v2-rollout-preflight.md`.

## Statement import and recovery

- Seeding now stages every proposed insertion for review, including rows formerly called automatic. It inserts only missing queue identities and leaves all older reports and decisions untouched. Repeated staging preserves existing proposals; changed proposals need a separately identified review.
- Reviewed batches contain 1–250 rows. Proposal 10 atomically inserts them with their durable receipt and complete approved source payload. Existing external identities cause an explicit conflict; they are never adopted or merged silently. Retrying the same batch recovers its receipt after a lost response or local receipt-file failure.
- statements:rollback now requires approval=archive:<batchId>. It archives unchanged rows from a durable v2 receipt, retaining original identities, source payload, relationships and journal history. Any later transaction edit, split, note or reconciliation relationship blocks the whole archive transaction. Legacy receipts require individual review; they cannot establish the absence of later edits.
- Undo an archive through Transactions history and Restore. Never delete a receipt or restore an old database over post-launch writes.

## Uncertain maintenance consumers

CSV imports and account merge tools remain available behind the operation gate; they are outside normal app flows and require a separately reviewed exact scope. Do not use them for automatic cleanup. The merge tool's old heuristics remain an explicitly unverified operator workflow, not an approved v2 migration. Database preservation guards/journals remain required and old clients must be quiesced before any approved operation.

The retirement command now preserves accounts and ledger rows when disconnecting. Use Accounts for the reviewed, interactive provider disconnect flow. Provider calls were not tested live.

Existing inspection/report commands can print private information by design in their operator context; never run them in an assistant session or publish their output without explicit record-level authorization. The development suite invokes only pure functions and disposable fixtures.

## Frozen comparison

Use identical synthetic fixtures for development comparisons. For separately authorized private comparisons, freeze the statement inputs, statement through-date, account mapping and complete database snapshot together. Store reports locally outside Git. Compare identities, source/provenance and relationship fields, all manual values, exact signed cents by account/month/category, splits, pending/removed/archive slices and note/file bytes. A row count or a code branch is not a recovery point.

See stackmint-v2-schema-review.md and section F of stackmint-v2-audit-proposal.md for schema and recovery requirements.
