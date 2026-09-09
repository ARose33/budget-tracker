# StackMint v2 implementation

Product direction and section D calculation rules approved by the user on September 8, 2026. The original audit remains the design record. Work is on codex/stackmint-v2, based on 7097b80b518a52f935f1327b8976de83556716e6; the original main checkout is untouched.

## Milestone 0: isolation and baseline

- GitHub's main branch was verified read-only and matches the baseline. GitHub's default branch is master; deployment instructions still target main. No remote changes. The deployed hosting revision is not verified.
- Installed the original lockfile with lifecycle scripts disabled, then added pinned development-only PostgreSQL and test tools. No real environment files were copied.
- Added a disposable in-memory PostgreSQL harness, with schema-only contracts read from system catalogs. No financial rows, Auth records, Storage contents, or secrets were fetched. The fixture covers seven StackMint tables, their views/functions/triggers/policies; it is not a backup or a copy of the shared database.
- Schema inspection confirmed Transfer categories are supported, two legacy triggers modify transaction status, and authenticated users have SELECT privilege on bank connection tokens. Proposed privilege changes must be separately reviewed before existing-environment execution. No schema or permissions were changed.
- Added isolated process credentials and a loopback-only network guard. Statement operator tools and private-PDF-dependent tests are not part of the synthetic suite.
- Verification: node scripts/test.mjs passes 19 tests (0 skipped), including baseline SQL and two-user isolation. The optional tsx loader failed on this sandbox's OS user lookup; it was removed and the same tests run with Node's native TypeScript support. The schema harness initially needed foreign keys ordered after primary keys; corrected without changing assertions.

## Commands

### Framework/build checkpoint

- Updated Next and its ESLint configuration together from 16.2.3 to the evaluated 16.3.3 security release. Other runtime libraries remain on the baseline lockfile versions.
- Bundled the existing Geist fonts locally and set the worktree's Turbopack root explicitly. No font or financial-service requests are needed during the isolated build.
- Verification: node scripts/isolated.mjs build passed, including compilation, TypeScript, and 29 generated pages. Isolated lint passed. No existing data/schema/configuration was changed.

Reference: https://nextjs.org/blog/august-2026-security-release

Use Node 24.19.0 and npm 11.6.2. This host has a local npm bootstrap under ignored .tools/npm; standard installations can use npm normally.

~~~text
npm ci --ignore-scripts
npm test
npm run lint
npm run typecheck
npm run build:isolated
npm run dev:isolated
~~~

npm run build and npm run lint remain the required production release checks after separate release approval. Local builds use build:isolated. No maintenance/import/sync command is a test command.

## Pending release gates

### Milestone 1 safety checkpoint

- Budget navigation now only reads. The retired ownership-claim endpoint returns 410 without creating a database client. Login return paths are constrained to the app; refresh cookies/cache headers survive redirects.
- Plaid webhooks require a fresh ES256 signature and a matching raw-body hash. Query-string secrets are no longer generated. No provider registration was changed.
- Categorization now serializes model field names into the actual PostgreSQL JSON contract; a database test proves it updates the intended uncategorized row once and rejects foreign categories/owners. Isolated mode blocks real Plaid and model calls.
- Verification: 25 synthetic tests passed, including signed/forged/stale webhook cases and the actual categorization RPC. Lint and TypeScript passed. Browser auth/persistence and final integration orchestration remain for later milestones.

### Shared commands and Budget workspace checkpoint

- Added schema proposals outside migration history for version-checked monthly edits, stable split allocations, reversible archives, revision journals, shared financial reads, atomic category naming and append-only note versions. Every executed proposal used an in-memory database. See stackmint-v2-schema-review.md for exact compatibility and recovery implications.
- Replaced Plan/Activity with a unified monthly workspace: Budgeted/Spent/Remaining, visible carryover, income planned/actual, review and pending queues, inline month-only edits and explicit future-month copying with per-category previews. Category activity uses the exact SQL contribution scope and opens the shared transaction editor. URL month/category context survives saves and reload.
- Transactions now uses paginated SQL filtering for split membership and history; bulk commands pass observed versions. Archive replaces physical deletion; historical rows can be restored. Note reads fail visibly and occur only on demand; saves retain old text and never overwrite or delete existing Storage objects. Analysis uses the same net category contribution rules and bounded periods.
- Browser verification used a loopback Auth/REST/Storage test double over real in-memory PostgreSQL, not a hosted Supabase service. Synthetic sign-in, budget save/reload, matching refund drilldown, transaction description save, note save/reload, invalid amount draft retention, mobile full-screen details and explicit October/December budget copying were exercised. November remained unset. Browser checks caught and resolved test-double CORS headers, an account-label issue and native month-input event handling. No real account or record was displayed.
- The isolated Next 16.3.3 production build passed with 29 generated routes. The latest test run passed 37 tests, including exact cent aggregation; isolated lint and TypeScript passed. Next dev refreshed only its generated instruction block in AGENTS.md; all enduring project rules remain intact.

### Provider preservation checkpoint

- Sync now acquires a fenced connection lease, stages a complete pagination cycle and commits ledger changes, cursor and a durable receipt together. Pagination mutations restart from the original cursor. Failed or oversized cycles cannot leave partial ledger updates. Pending-to-posted transitions retain transaction identity.
- Existing manual or historically unknown field authority is protected. Possible duplicates, conflicting provider fields and historical balances enter an explicit review queue. Account names, categories, notes, provenance and archived history remain intact. Accounts exposes hidden/historical accounts and accepted/kept provider review history.
- Disconnect pauses synchronization, removes the provider connection only on the user's explicit action, and preserves accounts, transactions and integration identifiers. Failed disconnects remain visible and retryable.
- Verification: node scripts/test.mjs passed 45 tests, zero skipped; isolated lint and TypeScript passed. Tests cover atomic failure, retry receipts, stale/overlapping leases, manual edits, pending identity, duplicate review, stale review rejection and preserved disconnect history. Real provider behavior and hosted database execution remain unverified. Review controls await the final synthetic browser pass.

Categorization orchestration, reconciliation/import safeguards, complete history access, final active-workflow verification and the separate full-diff review remain in progress. Existing-environment schema execution, verified backup/restore evidence, deployed-schema compatibility and release approval remain pending. Development approval does not authorize those existing-data/production operations. No production writes, migrations, integration calls or deployment have occurred.
