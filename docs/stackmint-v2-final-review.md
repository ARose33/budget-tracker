# Separate final v2 diff review

Reviewed September 9, 2026 against baseline `7097b80b518a52f935f1327b8976de83556716e6`, after implementation. The primary agent performed this separate pass; no independent human or second-agent review is claimed.

## Coverage and findings

| Area | Review evidence and outcome |
| --- | --- |
| Financial reads | Traced Budget → canonical contributions → category activity and Analysis. Inspected signed amounts, parent/allocation scope, pending/removed/archive exclusions, carry start/gaps/year boundaries and global counts versus page limits. Independent SQL fixtures demonstrate the intended corrections; historical source values are unchanged. |
| Financial writes | Traced editor, bulk actions, category/month commands, split/unsplit, note API, provider reviews and reconciliation to their owned SQL commands. Checked transaction boundaries, observed versions, stable IDs, archive behavior and journal/receipt retention. Found and fixed confirmation versions advancing with refreshed props; bulk failures clearing drafts; and cached record versions being adopted when opening an editor. |
| Auth and information exposure | Reviewed safe return paths, cookie/session client construction, identity-change cache clearing, ownership guards and proposed token grants. Found and fixed origin-changing auth redirects in local verification. Removed database row details/hints from public errors. Two-user SQL and browser checks pass. Hosted email/reset behavior remains a staging gate. |
| Provider side effects | Reviewed webhook verification, account/item acquisition, complete pagination-cycle staging, failure/receipt recovery, lease fencing and explicit disconnect. Duplicate Link exchanges do not replace existing credentials. Deferred Link initialization until an explicit connect/repair token exists, resolving the earlier duplicate-SDK warning. No live provider sync/model call was performed. |
| Import and operator paths | Reviewed shared PDF extraction, preserved statement proposals, atomic receipt import/archive and retained CLI gates. Fixed statement amount validation and two incorrectly placed/missing owner checks before operator writes. Operator tools were never executed against existing data. Legacy merge/CSV heuristics remain retained, gated and unverified; they are not automatic v2 cleanup. |
| Schema and compatibility | Inspected all 11 proposal files, function grants, owner restrictions, SECURITY DEFINER search paths, triggers and rollback implications. Complete proposal execution in new PostgreSQL fixtures preserves every original transaction field and creates no invented pre-v2 history. Original 13 migrations and hosting configuration remain unchanged. Existing-environment application is unapproved and unverified. |
| Feature retention and removals | Rechecked route, component, query, script, metadata, dynamic-import and dependency references. Active Accounts, Transactions, Analysis, reconciliation, auth, categorization and note/split flows remain. Uncertain callers and historical definitions remain. See the removal evidence map. |
| Runtime/build/preview | Reviewed scripts, process environment isolation, local fonts, Next configuration, lockfile changes, ignored artifacts and loopback API. No install/build hook performs a migration or real sync. Isolated tests/lint/types/build pass; browser evidence uses only generated fixtures. |

No known data-loss defect remains in the normal candidate workflows covered by this review. This does not certify production compatibility: staging must verify actual Auth/Storage/PostgREST contracts, shared-schema callers, concurrency, performance, backup/restore and a compatible rollback artifact. Account/category/connection metadata selectors still depend on the configured REST row cap; check their cardinalities before release. Transaction and financial aggregates are uncapped by that REST limit.

## Observed verification issues, resolved or bounded

- Temporary syntax errors during incremental edits were fixed before passing lint/type/build checks.
- The earlier native confirmation stalled one preview tab; the app uses in-app confirmations and testing continued in a fresh tab.
- A sign-out redirect changed 127.0.0.1 to localhost, violating the test double's exact CORS origin. Auth redirects now use validated relative destinations; sign-out/sign-in was verified on the same origin.
- The earlier simultaneous Plaid hooks loaded the SDK on Accounts render. The candidate only mounts Link after a user-requested token is obtained.
- Private-PDF-dependent operator tests were not run; generated-byte extraction and synthetic parser/reconciliation tests were run. No omitted private test is claimed as passing.
- PGlite proves SQL transaction/RLS behavior for these fixtures, not full hosted Supabase parity or true concurrent database sessions.

Review-driven fixes are isolated in commit `48b9783`. The final release document records commands, results, screenshots and the remaining approval gates.
