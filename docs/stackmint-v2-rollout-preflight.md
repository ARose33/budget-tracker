# StackMint v2 rollout — September 13, 2026

The user authorized publishing the complete v2 release and a coordinated maintenance pause, with **$0 additional cost**. This supersedes earlier development-only approval and password/organization prompts. Release means required checks, commit, push to `origin/main`, then stop, as specified in AGENTS.md. No Vercel CLI, direct Vercel operation, or paid provider/model call is part of this rollout.

## Verified recovery

The official Supabase CLI browser login uses the existing Google-authenticated account and obtains a short-lived database role. The existing database password is neither required nor reset. Native PostgreSQL 17.11 tools exported the complete source database, role definitions without passwords, Auth, archive schemas, Storage inventory and file bytes, application environment, project root encryption key, and remote configuration.

The encrypted recovery bundle is under `%LOCALAPPDATA%/StackMint-Recovery/backup-20260911T204516Z-03199106`, outside OneDrive and Git, with access restricted to the Windows user. All seven encrypted artifacts were decrypted in memory and matched their SHA-256 checksums.

The disposable project `blazhzqrxwwugvunkmud` was created in the existing Rose Residences organization after Supabase quoted and confirmed **$0/month**. Its database, Auth users and Storage were verified empty before restoration. The unrelated inactive project was left untouched.

- The native archive contains 99 TABLE DATA datasets. Every original row and column in all 99 datasets was restored and compared exactly using order-independent hashes.
- Application tables, both archive schemas, Auth and standard Storage records were restored to their actual schemas. Managed platform migration ledgers, old Realtime partitions, cron history/configuration and protected vector metadata were preserved and verified as inactive records under `stackmint_recovery_metadata`, avoiding replay of obsolete platform migrations or scheduled jobs.
- Supabase-managed default privileges were not overwritten. The source Vault secret table was empty. No real email, provider, model, webhook or cron work was invoked by the restore.
- The one stored file was uploaded to the isolated project, downloaded again and matched its original checksum. The two-bucket inventory and original metadata are retained in the encrypted backup.
- The complete v2 migration applied atomically to the restored database. In-transaction fingerprints confirmed every original field and row in the public/archive tables, Auth users and Storage objects was unchanged. No fictitious historical revisions were created.

Private manifests and detailed comparison hashes remain in the protected recovery directory. No credentials, real records, file names or financial totals are included in this repository.

## Release contract

Migration `20260913184110_stackmint_v2_release.sql` combines the 12 reviewed additive steps. The original 13 migrations remain unchanged. Its SHA-256 is `52F28E5D554023EB87A17D38EF8E73A344D1BEB5D77B5DCF48370EE44B4B909D`.

Hosted contention exposed Supabase's documented PostgREST 14 retry loop for custom `40001` errors. Follow-up migration `20260913185712_stackmint_v2_http_conflicts.sql` changes only the eight affected function definitions to return `PT409`/HTTP 409 immediately. It preserves the already-applied migration and all records. Its SHA-256 is `0E71F0E4EA956E6352A74D8BA338FD6A0DCF66C14F17514A796FCC5BD77D9731`. The note API recognizes that conflict response. See [Supabase's guidance](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b).

V2 browser, server and service clients send `x-stackmint-version: 2`. A database trigger rejects old HTTP writers on StackMint's mutable tables during cutover, while RLS continues to enforce ownership. Direct database recovery access and unrelated wealth-management tables are outside that HTTP compatibility gate. Original legacy note files remain readable; old Storage writers cannot overwrite them. V2 saves immutable note versions in the database.

The production runner requires verified restoration, file recovery, staging migration, hosted checks, an identical migration checksum, and a fresh completed production backup. It applies the schema and matching migration-history entry in one transaction, with original-field preservation assertions. Any failed assertion aborts the transaction.

## Validation and execution status

- `node scripts/test.mjs`: **60 passed**, no failures, skips or cancellations, including the hosted-conflict regression.
- `npm run lint`: passed through the isolated environment and outbound network guard.
- `npm run build`: passed through the same isolated environment; Next 16.3.3 generated 29 routes.
- Prior desktop/mobile browser verification used synthetic records; see the release candidate evidence.
- All seven hosted checks passed: restored-user login, restored Budget/Transactions/Analysis reads, synthetic-user login, cross-user isolation, old-writer rejection, new-write persistence and real concurrent edits. Two simultaneous commands against version zero produced one success and one HTTP 409; a new read showed exactly one increment and the winning amount.
- A fresh production checkpoint was exported and all seven artifacts encrypted and checksum verified at `backup-20260913T185204Z-7f5ba1e4`. The original restore drill establishes recovery capability; this fresh checkpoint preserves the latest source state and is not described as a second restore drill.
- `origin/main` was checked remotely and remains at baseline `7097b80b518a52f935f1327b8976de83556716e6`. No force push is permitted.
- Both production migrations were applied together successfully. Original-field preservation assertions passed inside the transaction; the complete original database records remain intact. This commit is the application publication artifact for the required `origin/main` push. The remote build is not inspected after that push, following AGENTS.md.

Live Plaid/model calls and email delivery remain untested to respect the no-cost and no-unsolicited-messages constraints. Existing private CSV/account-merge maintenance flows are outside this release. A rollback must retain the additive schema, v2 write contracts, immutable notes and post-launch records; do not restore an old database or deploy destructive v1 writers. Use a compatible application correction or forward schema fix, retaining operation receipts and history.
