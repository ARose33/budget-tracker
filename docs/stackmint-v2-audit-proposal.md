# StackMint 2.0 — audit and proposal

**Status: product direction and calculation rules approved September 8, 2026.**
Audit date: September 8, 2026. All monetary examples below are invented.

## A. Assessment and verified baseline

StackMint has a useful foundation: monthly category budgets, transaction search and bulk review, split allocations, transaction notes, Plaid connections, statement reconciliation, and three analysis views. Keep those capabilities and the existing stack. The largest problems are inconsistent financial definitions, writes hidden inside reads, unsafe lifecycle operations, and scattered mutation/cache handling. A unified Budget workspace will help, but its totals must become explainable and reliable first.

The audit supports proceeding with v2 after the preparation and preservation gates below. It does **not** establish that the currently deployed app, live database policies, or production integrations are healthy.

### Which source was audited

The outer workspace has an incomplete Git directory and is not recognized as a repository. A nested [recovered checkout](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/) is a clean repository on **main**, commit **7097b80b518a52f935f1327b8976de83556716e6**, titled “Add AI-assisted transaction categorization.” Its local origin/main points to the same commit. This is the newest available local baseline, not a verified production revision.

There are 16 differing or recovery-only tracked files compared with the outer copy, including newer categorization and migration work. The older deployment/release folders are incomplete snapshots; they were not removed or treated as canonical. The recovered checkout has one registered worktree and no tracked modifications after verification.

The configured remote is GitHub's ARose33/budget-tracker. Local origin/HEAD points to origin/master, while instructions specify deployment through origin/main. Reading the actual remote default branch failed because this environment's Git lacks its HTTPS helper. **Remote branch state and the deployed commit remain unverified.** Resolve them read-only before choosing the v2 starting commit. Do not combine the two source trees automatically.

[Repository instructions](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/AGENTS.md) define deployment as lint, build, commit, and push to origin/main; GitHub then triggers Vercel. [vercel.json](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/vercel.json) also declares a daily 12:00 UTC Plaid cron. The current hosting project, production environment settings, scheduler execution, and database migration state were not accessed.

### Technology and persistence

| Area | Observed implementation | Recommendation |
|---|---|---|
| Application | Next.js App Router 16.2.3; React 19.2.4; TypeScript 5.9.3 installed | Keep. Read installed Next guides before changing framework code. |
| UI | Tailwind 4, Base UI/shadcn wrappers, Lucide, Recharts | Keep; use compact tables and shared controls. |
| Client state | React Query 5; URL month/filter state; component selection/sort/page state | Keep React Query; centralize scope, invalidation, and authentication lifecycle. |
| Backend | Next route handlers, direct authenticated Supabase queries, PostgreSQL RPCs | Keep; use atomic commands for operations spanning rows. |
| Storage/auth | Supabase database and Auth; notes in private-intended Storage bucket transaction-notes | Preserve all three stores. Actual bucket policy and grants need verification. |
| Integrations | Plaid SDK/Link, cron and webhook sync; user-triggered OpenAI categorization through AI SDK | Preserve; test with fakes and blocked external access. |
| Statements | Separate HTTP text parser and PDF/CSV CLI reconciliation/import pipelines | Preserve active review; establish external callers before retiring tools. |
| Tooling | Lockfile, ESLint, TypeScript, Node test runner; no checked-in CI workflow found | Add one reproducible verification entry point after approval. |

Installed Supabase SSR is 0.12.0 and supabase-js is 2.108.2; AI SDK is 7.0.93, OpenAI adapter 4.0.60, pdfjs-dist 5.7.284. Package ranges and the lockfile are distinct evidence. There is no declared runtime/package-manager pin. Tests used bundled Node 24.19.0; this is a suitable target to validate and pin, since several installed dependencies require Node 22 or newer.

Application tables referenced include accounts, transactions, budgets, budget_categories, bank_connections, statement_reconciliation_reviews, and legacy plaid_items. The generated [database types](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/src/lib/supabase/types.ts) also contain unrelated table families. They may belong to a shared database; ownership and consumers are unknown. They are **not** deletion candidates.

The 13 committed migrations do not define the complete original schema. Some typed database functions/views have no committed definition, and Storage creation/policies are absent. There is no basis yet for claiming a fresh database can reproduce production. No active rules/preferences subsystem was located in this app; if such data exists elsewhere, it must remain included in the preservation inventory.

No application-authored localStorage, sessionStorage, IndexedDB, or service-worker persistence was found. Supabase uses auth cookies; React Query holds financial results in memory. A manifest/icon does not establish offline support. Actual browser state was not opened or cleared.

## B. Prioritized findings

“Confirmed” below means demonstrated by the inspected source or local checks. It does not mean reproduced against production. Severity reflects potential user impact.

### F1 — Critical if enabled: legacy claim can reassign other users' data

**Evidence:** [claim route](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/src/app/api/auth/claim-legacy-data/route.ts#L13) checks a feature flag and authentication, then uses the service role to update every row whose user_id differs from the caller. It is not restricted to an administrator or an approved legacy owner. The per-table updates are non-atomic; connections, reviews, and note paths are not included. NULL owners are not matched by this predicate.

**Impact:** If enabled, an ordinary authenticated caller could take ownership of other users' financial rows and break related access. There is no evidence the flag is enabled live.

**Fix:** Retire this general-purpose route after checking callers; retain all data. Any genuine ownership recovery must be a separately reviewed, explicit mapping with a recovery point. **Regression risk:** legitimate onboarding/recovery callers; verify those before removing the endpoint. Never “fix” ownership during v2 development.

### F2 — High: deletion and split edits destroy identities/history

**Evidence:** [deleteTransactions](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/src/lib/queries/transactions.ts#L329) issues physical deletes; [bulk Delete](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/src/components/transactions/bulk-actions-bar.tsx) invokes them immediately. The latest [split RPC definitions](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/supabase/migrations/20260908200533_add_ai_categorization_workflow.sql#L238) delete every child and insert replacements on save; unsplit also deletes children.

**Impact:** Original split IDs, relationships, annotations, and later auditability can be lost. A confirmation dialog alone would not satisfy the preservation requirement.

**Fix:** Preserve parent and child identities, journal explicit edits, and archive superseded allocations without deleting them. Replace Delete with an explicit, reversible archive workflow and accessible history. **Regression risk:** every effective-transaction query and split editor must exclude superseded allocations exactly once. Existing migration files remain unchanged.

### F3 — High: connection cleanup hides financial history and deletes metadata

**Evidence:** [connection DELETE handler](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/src/app/api/plaid/connections/[connectionId]/route.ts#L60) marks account transactions removed, hides accounts, calls provider removal, and deletes the connection record. Ownership checks exist, but the transaction update covers account history rather than only a disposable sync artifact.

**Impact:** Manual and imported history can disappear from reporting; failure between local and provider operations leaves partial state. The cleanup path may also need provider access that an already-revoked connection cannot supply.

**Fix:** Retain connection/account/history records; expose inactive history separately. A future explicitly requested provider disconnect should change connection state through a recoverable command and leave ledger history intact. **Regression risk:** status handling, reconnection, token access, and reporting scope. Do not restore previously removed flags automatically.

### F4 — High: merely viewing a month creates budgets

**Evidence:** [Budget query](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/src/app/budget/page.tsx#L73) calls [ensureBudgetRows](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/src/lib/queries/budget.ts#L242) before reading. It copies a previous month's rows when no rows exist, returns early if even one row exists, and fails to surface several query/insert errors.

**Impact:** Navigation, query retries, and concurrent tabs can create or incompletely initialize historical plans. Those inserted plans affect cumulative rollover. A partial month can stay incomplete.

**Fix:** Reads must be pure. An unplanned month should still display activity and offer an explicit “Create this month's budget” preview. Create missing rows atomically and idempotently after a user action, preserving existing rows. **Regression risk:** new-month convenience and rollover; prove repeated reads leave every record unchanged.

### F5 — High: budget edits have broad, non-atomic effects

**Evidence:** [updateBudgetLineItem](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/src/lib/queries/budget.ts#L350) renames the category globally, creates missing budget rows, then changes the selected and all existing future months. Category creation also spans separate writes. Future-month enumeration is not fully paginated.

**Impact:** Editing an old month can replace intervening and future plans or partially save. Category rename changes historical labels globally. The dialog mentions carry-forward, but cannot limit the edit to the selected month.

**Fix:** Selected month by default; explicit bounded future-month selection with a before/after preview. Separate global taxonomy edits from monthly amounts. Use an atomic, version-checked command and report the exact changed months. **Regression risk:** users who rely on carry-forward; retain it as an explicit action, without creating an unrequested recurring-budget system.

### F6 — High: financial reports disagree on refunds, periods, and unplanned activity

**Evidence:** [Budget RPC](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/supabase/migrations/20260810163102_fix_budget_rollover_and_plan_totals.sql#L25) and [monthly spending RPC](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/supabase/migrations/20260803201637_harden_transaction_split_reporting.sql#L123) sum absolute amounts. [Category analysis](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/src/lib/queries/analysis.ts#L54) takes only negative amounts. Budget starts with persisted budget rows, so a category or month without a plan can omit activity and rollover contributions. Analysis paths also use different date-window boundaries.

**Impact:** For a synthetic expense of -100 and a refund of +25, the implementations imply 125 in Budget/group spending and 100 in category detail. The proposed net-spending result is 75. Income reversals are similarly overstated by absolute values. A “12 months” report can include a partial extra month or future records.

**Fix:** Approve the rules in D, then use a single contribution model, explicit date-only boundaries, and server-side aggregates. Display activity without inserting missing plans. **Regression risk:** corrected historical displayed totals will change. Publish exact fixture-based before/after explanations; preserve source amounts, dates, categories, and budgets.

### F7 — High: a category drilldown can show a different amount than its total

**Evidence:** [getTransactions](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/src/lib/queries/transactions.ts#L124) finds split parents by category, then returns parent transactions and all allocations. A -120 parent with a -70 allocation in the selected category displays a -120 parent amount while the Budget counts 70.

**Impact:** Users cannot reliably answer “Why is this number what it is?” The split-parent lookup also has no matching date/account bound or full pagination.

**Fix:** A category drawer must show the contribution to that category, with the parent amount as labeled context. Reuse the same ownership, date, account, status, and allocation predicates as the aggregate. **Regression risk:** duplicate counting when expanding a parent and unstable results on large histories; test both.

### F8 — High: AI categorization has a broken request-to-database contract

**Evidence:** [applyAssignments](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/src/app/api/transactions/categorize/route.ts#L47) sends objects with transactionId/categoryId directly to an RPC whose [JSON record definition](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/supabase/migrations/20260908200533_add_ai_categorization_workflow.sql#L64) expects transaction_id/category_id. The cast through unknown hides the mismatch from TypeScript.

**Impact:** The shown SQL rejects those entries as missing IDs, so the batch can process zero after a paid model call. Existing helper tests never exercise this boundary. Two parallel write calls can also partially succeed before an error is reported.

**Fix:** Explicit serialization, a single atomic apply contract, and synthetic API/RPC integration tests. Preserve the existing owned-category validation and “only uncategorized rows” guard. Allow uncertain model results to remain for review; show the exact batch scope and actual partial/completed outcome. Keep AI opt-in and bounded; describe that descriptions, amounts, account names, and history examples are transmitted. store:false is useful but is not a blanket no-retention guarantee. **Regression risk:** batch retry/cost behavior and review states; no real model calls during tests.

### F9 — High: sync can overwrite manual edits or adopt the wrong record

**Evidence:** [Plaid upsert](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/src/lib/plaid/sync.ts#L280) replaces provider-controlled date, description, account/amount, and provenance fields when an external ID reappears. [Duplicate scoring](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/src/lib/plaid/sync.ts#L174) can meet the match threshold from matching account/date/amount without description agreement; not_duplicate is selected but not honored by the matching decision. No pending_transaction_id transition handling was found.

**Impact:** User corrections can be undone. Similar legitimate transactions can be treated as the same record; pending-to-posted transitions can strand categorization, notes, or split links.

**Fix:** Automatic replay matching only for verified provider identities and lineage. Preserve known manual fields; treat ownership of preexisting edited fields as unknown and stage conflicting provider changes for review. Honor “Not a Duplicate.” Record provider observations separately from explicit user overrides where needed. **Regression risk:** more review items and pending/posting reconciliation. Never run a deduplication/backfill to repair existing records as part of this change.

### F10 — High: sync concurrency and error recovery are incomplete

**Evidence:** [sync connection](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/src/lib/plaid/sync.ts#L364) writes pages before committing the cursor, and restores the original cursor on failure. No per-connection lock/fencing was found. [Error handling](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/src/lib/plaid/sync.ts#L437) sets status=error, while automated and bulk sync selectors require active.

**Impact:** Webhook, cron, and user sync can overlap; a transient error can stop future automated retries. Partial-page replay can revisit manual fields even where a unique index prevents duplicate insertion.

**Fix:** Add a database-backed lease with generation checks; classify retryable errors separately from reconnect-required errors; make page replay and pending transitions idempotent. **Regression risk:** sync starvation, stale leases, cursor regressions. Test concurrent requests, pagination mutation, crash/retry, and revoked credentials using fake provider responses only.

### F11 — High: webhook authenticity is optional in the current handler

**Evidence:** [webhook guard](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/src/app/api/plaid/webhook/route.ts#L9) accepts requests when the optional shared secret is absent. It does not verify Plaid-Verification JWT signatures and body hashes. Item IDs from accepted requests can trigger service-role sync.

**Impact:** Unauthenticated requests can initiate work if the optional secret is unset; a secret in a query URL is also vulnerable to routine URL logging. Current production configuration is unknown.

**Fix:** Validate the raw-body signature, algorithm/key, freshness, and body hash before dispatch, following [Plaid's verification documentation](https://plaid.com/docs/api/webhooks/webhook-verification/). Retain replay/idempotency protections. **Regression risk:** rejecting legitimate webhooks if rollout/configuration is mismatched. Prepare and test locally; external registration/config changes require separate authorization.

### F12 — High: failed reads/saves can look like empty data or success

**Evidence:** [Budget](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/src/app/budget/page.tsx), [Transactions](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/src/app/transactions/page.tsx), Accounts, and Analysis commonly combine loading flags with empty defaults rather than explicit failed states. Transaction mutations have uneven pending/error handling. [Notes GET](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/src/app/api/transactions/notes/route.ts#L51) suppresses per-object Storage failures; note saves upsert and clearing a note removes its object.

**Impact:** An outage can look like a zero budget or a missing note, encouraging an overwrite. Repeated clicks can repeat writes. Zero affected rows can be mistaken for success.

**Fix:** Distinguish loading, truly empty, failed, stale, saving, saved, and conflict. Keep failed edits locally for retry; require row/version confirmation. Retain prior note versions before explicit future edits/clears and never interpret unavailable as blank. **Regression risk:** stale drafts and note compatibility; verify reload, failure, concurrent edits, and Storage failure paths.

### F13 — Medium, with isolation implications: cache invalidation is inconsistent

**Evidence:** [Providers](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/src/lib/providers.tsx) sets 60-second freshness and disables focus refetching. Category/budget/transaction/reconciliation/Plaid mutations invalidate different partial key sets. Some Plaid keys refer to the older uncategorized-count name. Query keys are not consistently user-scoped; no shared auth-change cache reset was found.

**Impact:** Budget, Analysis, category menus, and review badges can disagree after a successful save. Sign-out currently navigates through a full-page form, reducing ordinary cache carryover, but cross-tab auth transitions remain unverified.

**Fix:** User-scoped key factories and one mutation invalidation policy covering dependent views. Clear/cancel cached work when identity changes. **Regression risk:** excess refetches or lost unsaved edits; test both, including two users in one browser session.

### F14 — Medium; high-priority isolation verification: auth and schema contracts need tightening

**Evidence:** [auth callback](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/src/app/auth/callback/route.ts#L7) builds a redirect from unconstrained next; [login](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/src/app/login/page.tsx) permits strings starting with /, including protocol-relative URLs. [Supabase proxy](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/src/lib/supabase/proxy.ts#L32) ignores the installed SSR library's second setAll headers argument and returns fresh redirect responses without copying refreshed cookies.

**Impact:** External redirect destinations and inconsistent refresh behavior are possible. The installed SSR contract specifically supplies cache-control headers for auth-cookie responses; live cache exposure was not tested. See the [official SSR changelog](https://github.com/supabase/ssr/blob/main/CHANGELOG.md).

**Fix:** Same-origin validated return paths, explicit callback error handling, and cookie/cache-header propagation. Keep server getUser checks and ownership filtering. Before release, verify table/column grants for bank_connections.access_token and ownership of every referenced account/category, not only the transaction row. Owner RLS alone does not prove secret-column restriction or same-user foreign-key relationships. **Regression risk:** login/reset flows and old links. Token exposure or cross-user record access is a verification concern, not a confirmed production leak.

### F15 — Medium: capped client aggregation can silently omit history

**Evidence:** [category analysis](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/src/lib/queries/analysis.ts#L54) downloads rows without complete pagination; the [reconciliation summary](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/src/app/api/statement-reconciliation/route.ts#L20) downloads up to 5,000 rows to derive counts and filters. The server's configured result cap may be lower. Notes can require 50 object downloads per page.

**Impact:** Large histories can produce incomplete totals/queues, with latency growing as more rows are fetched. No production latency or actual row-limit value was measured.

**Fix:** SQL aggregates for counts/totals/filter facets; indexed date/category/account access after query-plan inspection in isolation; bounded parent context; fetch notes on demand with explicit availability state. **Regression risk:** pagination stability, ownership filtering, and group totals. Test well beyond 1,000 and 5,000 synthetic records.

### F16 — High for operator safety: maintenance scripts are not safe test commands

**Evidence:** [seed review](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/scripts/seed-statement-review.mjs#L79) inserts “automatic” transactions and later changes other pending reports to ignored without an explicit apply switch. [Merge](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/scripts/merge-plaid-accounts.mjs) and [retirement](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/scripts/retire-plaid-connection.mjs) tools can move/hide history or remove integration state. Even dry-run tooling reads configured remote data and writes sensitive reports.

The [apply workflow](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/scripts/lib/statement-review.mjs#L332) has useful manifest fingerprints, deterministic IDs, bounded batches, and post-write verification. However, a verification or receipt-file failure can occur after committed inserts. [Rollback](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/scripts/lib/statement-review.mjs#L452) deletes receipt IDs without proving later field/relationship changes are absent. [Generated instructions](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/scripts/reconcile-statements.mjs#L263) claim a server rollback validation that the implementation explicitly says is unavailable.

**Fix:** Keep callable tools quarantined from builds/tests. Require environment identity, explicit reviewed operation, durable operation receipts, and recoverable commands. Correct misleading documentation after approval. Do not use this rollback as a release rollback. **Regression risk:** legitimate one-off operations and automation outside Git; caller inventory is required. None of these tools was executed.

### F17 — Medium: tests/build/dependency evidence is weaker than a green type check

**Evidence:** The 17 executed tests cover selected pure helpers and mocked statement operations, not database RPCs, UI persistence, multi-user RLS, or real sync orchestration. [PDF parser tests](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/scripts/lib/statement-parser.test.mjs) depend on private local statements and skip when absent. There is no single full application test script or CI workflow. The build currently depends on Google font fetches and warned about nested lockfile root inference.

Next 16.2.3 precedes subsequent [July](https://nextjs.org/blog/july-2026-security-release) and [August security releases](https://nextjs.org/blog/august-2026-security-release). The advisories are configuration-dependent; this audit does not establish an exploitable path for each advisory.

**Fix:** Replace private test inputs with purpose-made fixtures, add meaningful financial/API/E2E coverage, pin a supported runtime, repair reproducible build tooling, and update Next plus its matching ESLint package to an evaluated supported patched 16.x release in a separate commit. Do not upgrade every package. **Regression risk:** framework/cookie/build changes; use local Next docs and run the full isolated gate.

### F18 — Medium: current presentation obscures meaning and has accessibility gaps

**Evidence:** [Plan/Activity tabs](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/src/app/budget/page.tsx#L204) separate editing from usage. [Summary rendering](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/src/components/budget/budget-summary-card.tsx#L137) takes absolute values, hiding negative signs. [Progress](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/src/components/budget/budget-line-item.tsx#L38) treats positive spending against zero availability as 100%, which misses its own over-100 warning. [Month buttons](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/src/components/layout/month-picker.tsx) and [mobile navigation](https://github.com/ARose33/budget-tracker/blob/7097b80b518a52f935f1327b8976de83556716e6/src/components/layout/sidebar.tsx) lack explicit accessible names; the mobile sheet lacks an explicit title. Transaction selection/sort controls need accessible labeling/state, and the wide table has no designed compact mobile equivalent.

**Impact:** A deficit can resemble a surplus; zero-budget overspending is understated. Keyboard/screen-reader navigation and mobile review are unnecessarily difficult. These observations come from source, not a completed visual or assistive-technology test.

**Fix:** The workspace in D, signed values, visible textual states, meaningful forms, semantic tables, and tested mobile layouts. **Regression risk:** interaction density and focus management; preserve information rather than hiding columns without an alternate detail view.

### Audit coverage and verification limits

The source inventory contains 95 files under src, 13 migrations, and 13 script/library/test files under scripts. Review included the full application route surface and relevant cross-layer call paths, not only the Budget screen.

| Area | What was inspected | Executed verification | Still unverified |
|---|---|---|---|
| Baseline/config/history | Both source copies, Git/worktrees/status, instructions, package/lock/config, local history of retired controls/balances, Plaid cutover, splits, review, rollover, property groups, AI | Read-only local Git/source checks | Remote HEAD, deployed revision, hosting settings |
| Pages/navigation | / redirect; /budget; /transactions; /accounts; /statement-reconciliation; three /analysis pages; /login; /reset-password; shared layout/icons/manifest/styles | Type/lint checks | Rendered desktop/mobile, screen reader, real sessions |
| Auth | /auth/callback, /auth/sign-out, proxy, clients, /api/auth/claim-legacy-data | Source tracing | Live Auth settings, redirects, cache behavior, grants |
| Transactions/Budget/Analysis | Query modules, math, filters, bulk edits, category/account controls, splits, notes, categorization UI/API, SQL reporting definitions | Budget math, filter, categorization helper tests | SQL results and end-to-end persistence |
| Plaid | Link/exchange/sync/health/cron/webhook; connection sync/link/delete routes; sync engine/client; cutover docs/migrations | Source tracing only | Provider behavior, live locks/cursors, credentials, scheduled execution |
| Statements | /api/statements/parse; reconciliation GET/POST/UI/RPC; all CLI entry points and write gates; matching/review/receipt paths; PDF parsing/validation architecture | Synthetic text-parser, reconciler, review tests | Real PDF formats; some bank-specific parser branches only sampled; external CLI callers |
| Schema/storage | All 13 migration files; generated types; ownership filters/security-invoker functions; notes bucket access | Source comparison | Complete base schema, applied migrations, other schemas/apps, Storage objects/policies, triggers/DB jobs, recovery |
| UI/library cleanup | App-specific components reviewed; generic wrappers/import/export/accessibility patterns scanned; asset/package references searched | Lint/type checks | Browser-only behavior and dependency internals beyond relevant SSR contracts |
| Deployment/toolchain | Scripts/hooks, env variable names and presence only, cron config, Next docs, dependency engines/security release notes | Checks below | Clean install reproducibility, successful full build, deployment |

This is a repository-wide source audit, **not a complete runtime, penetration, or live-database audit**. The isolation and schema gaps are release gates.

Checks were inspected for side effects before execution. In the recovered checkout, the bundled Node executable ran:

~~~text
node --test src/lib/budget-math.test.ts src/lib/statements/parser.test.ts scripts/lib/statement-reconciler.test.mjs scripts/lib/statement-review.test.mjs src/lib/ai/transaction-categorization.test.ts src/lib/transaction-filter-params.test.ts
PASS: 17 tests; 0 failures; 0 skipped.

node node_modules/eslint/bin/eslint.js
PASS: exit 0.

node node_modules/typescript/bin/tsc --noEmit --incremental false
PASS: exit 0.

node node_modules/next/dist/bin/next build
BLOCKED: Geist/Geist Mono Google font fetch failed.
Also warned about inferred workspace root from nested lockfiles.
~~~

npm was unavailable, so the underlying lint/build executables were used; this is not a claim that npm run build passed. The build used process-only placeholder credentials, a loopback Supabase URL on a closed port, sandbox Plaid mode, disabled legacy claim, and disabled Next telemetry. No environment file was changed. Only ignored build output was generated.

The private-PDF-dependent test file was deliberately not executed; skipping private tests is not equivalent to coverage. No installation, database access, migration, dev server, import, sync, webhook, AI request, restore, production configuration change, commit, push, or deployment was performed.

## C. Feature and code disposition

| Area | Classification | Reason and history access |
|---|---|---|
| Monthly category budgets, groups/subcategories, income/expense planning, expense rollover | KEEP / REFACTOR | Core product. Preserve IDs, taxonomy, all monthly rows, and history. Correct calculations explicitly. |
| Plan/Activity split | REPLACE | One Budget workspace; retain both planning and transaction-review capability. Old links resolve to the equivalent month/context. |
| Transactions search/filter/sort/pagination, bulk edits, manual review, notes, splits, Not a Duplicate | KEEP / REFACTOR | Active workflows; stable identity, safe edits, clear status, consistent drawer reuse. |
| AI categorization | KEEP / REFACTOR | Recent active feature; fix the boundary bug and controlled batch/review behavior. No automatic recategorization. |
| Plaid link/reconnect/manual sync/cron/webhook | KEEP / REFACTOR | Retain service/provider identifiers and working integration. Replace unsafe cleanup implementation. |
| Reconciliation review queue and decisions | KEEP / REFACTOR | Explicitly retained in recent history. Keep navigation even when empty; show completed review history. |
| Spending, Cash Flow, Year over Year | KEEP / REFACTOR | Active analysis, consolidated financial definitions. Preserve access; clarify scope instead of adding dashboards. |
| Removed manual account controls and balances/net-worth UI | REMOVE CODE / RETAIN DATA | Git history confirms retirement. Keep historical balances, hidden/retired accounts and their transactions accessible read-only. |
| AddAccountDialog and its otherwise uncalled createAccount path; updateAccountBalance/toggleAccountHidden helpers | REMOVE CODE / RETAIN DATA candidates | No remaining source/route/dynamic/script references found beyond their own definitions/internal chain. Recheck the closed reference graph in the chosen baseline before removal. No account schema changes. |
| Unused updateBudgetLimit, groupCategories, findDuplicates wrapper; unused react-table package and starter SVGs | REMOVE CODE / RETAIN DATA candidates | Static call/asset search found no active consumer; verify build and package/script references before a separate removal commit. Do not remove active split/review/duplicate logic. |
| /api/statements/parse and its separate text parser | UNCERTAIN | No active UI caller found, but HTTP entry points can have external callers. Retain by default; hard-coded target-year behavior needs explicit compatibility treatment. |
| CSV import, merge/retire/inspection/seed/apply/rollback tools | UNCERTAIN | Runnable entry points may have operator/external consumers. Retain with clear non-test status until confirmed; preserve associated reports/data outside source control. |
| Papaparse/pdfjs and statement parsing libraries | KEEP pending caller decision | CLI/HTTP use remains, even though import dialogs were retired. |
| Teller-era/plaid_items data, old balances, migration history | REMOVE obsolete runtime CODE only after proof / RETAIN DATA | No active Teller runtime found. Keep schema/migrations/identifiers; add owned read-only legacy account/connection history without exposing credentials. |
| Unrelated generated database table families and undocumented functions/views | UNCERTAIN | Potential shared-database consumers. Inventory only; no cleanup, dropping, or ownership changes. |

Dead-code evidence included source and script searches, route files, dynamic imports, feature flags, cron/webhook entry points, SQL function definitions and callers, and relevant local Git history. External callers, live database jobs, and dashboard-configured functions cannot be disproved from Git, so their removals remain uncertain.

Relevant history should be accessible through **Accounts → History** and **Transactions → Include archived/source-removed history**, plus reconciliation history. Archive visibility must be clearly labeled and must not silently alter ordinary Budget inclusion. Unknown tables stay in the preservation inventory; do not invent a user-facing feature for unrelated data without identifying its owner.

## D. Proposed v2 product

### Navigation and actual friction

Use StackMint consistently in the app's branding. Keep **Budget, Transactions, Reconciliation, Accounts**, and the existing **Analysis** group. Budget is the default destination. No net-worth revival, envelope/zero-based budgeting conversion, subscription system, or new financial provider is proposed.

Today, Plan is the default tab and focuses on amounts; Activity holds spending/progress and another summary presentation. Users switch views to connect intent to outcome, then leave Budget for the transactions explaining it. Editing can affect future months while category renames affect every month. Similar totals are derived through different paths, and “available” can be confused with bank cash. Those are interaction and correctness problems, not merely styling preferences.

### Desktop structure

The following is a proposed structure, not a screenshot of the existing app:

~~~text
StackMint | Budget | Transactions | Reconciliation | Accounts | Analysis

Budget     [ <  September 2026  > ] [This month]
           All accounts • budget activity • Updated [time]

Expenses: Budgeted [ ]  + Rollover [ ]  − Spent [ ]  = Remaining [ ]
Income:   Planned [ ]   Received [ ]   Still expected / Above plan [ ]
Budget remaining is not your bank balance.

Needs attention: [Over budget] [Uncategorized] [Category review] [Pending]

Category / subcategory      Budgeted        Spent       Remaining
Housing                     [Edit amount]   [Open]      [signed value]
  Rent                      [Edit amount]   [Open]      [signed value]
  Maintenance               [Edit amount]   [Open]      [signed value]
Groceries                   [Edit amount]   [Open]      [Over by ...]
Unbudgeted categories       [Set budget]    [Open]      [signed value]

[Search categories] [Show all / Needs attention]   [Add category]

Click category → side drawer:
September • Groceries • All accounts
Budgeted + rollover − net spending = remaining
Date | Description | Account | Category contribution | Review state
Refunds carry their sign; split parents are expandable context.
[Change category] [Review] [Notes] [Split details] [Open in Transactions]
~~~

Prefer one information-rich table with collapsible groups and stable column alignment. Expense rows show Budgeted, Spent, Remaining together; income uses Planned, Received, Difference labels. Rollover is visible in the summary and row breakdown, so Budgeted alone is never mistaken for total availability. Progress bars supplement numbers; “Over by …” and a negative remaining value do not depend on color. Spending with no budget is an explicit attention state.

Uncategorized inflows/outflows are visible separately and are not quietly assigned to an expense category. A category with transactions but no budget row appears with “No budget set”; reading it creates no data.

### Interactions and state

1. **Choose a month:** previous/next, direct month/year picker, and This month. Store the month in the URL. Browser Back/Forward and reload preserve it. An unplanned month offers a preview of copying an existing month, with no writes until Create.
2. **Edit a budget:** click its amount; enter a value in a labeled form; Enter saves and Escape cancels. Default scope is **selected month only**. Optional “Apply to selected future months” lists exactly which existing plans change and preserves other overrides. Show the old/new amounts and affected months before that broader save. Recurring defaults are deferred.
3. **Inspect spending:** click category/spent amount to open a drawer without leaving the month. Use a URL category ID, not the mutable name. Show all contributing rows with a total matching the header, even with pagination.
4. **Recategorize or review:** save inside the drawer; update both old and new category totals. If the row leaves the filter, explain that it moved and keep focus at a predictable position. Notes/splits use the same editor as Transactions.
5. **Open full Transactions:** carry month/category/account/status scope and a return-to-Budget URL. Clearly show when a user broadens that scope. Transactions manages activity; it does not introduce a second plan editor.
6. **Resolve attention:** show locally scoped counts and sums; label genuinely global queues as global. Distinguish bank pending from awaiting category review.

On mobile, use a compact category list with the three labeled values across two lines, not a clipped desktop table. The month control and summary remain near the top. A full-screen detail sheet replaces the desktop drawer; it retains a visible month/category title and Back/Close. Transaction cards expose amount/contribution and review status first, with account/notes/split detail available on expansion. Bulk actions show the selected count and remain reachable without horizontal scrolling.

Keyboard access uses semantic links/buttons/forms/table headers, accessible names, aria-sort/selection state, a titled focus-trapping drawer, Escape handling, and focus restoration. Do not add spreadsheet-style arrow navigation unless it can be implemented and tested correctly.

| State | Required behavior |
|---|---|
| Loading | Stable skeletons; no temporary zero totals; preserve the requested month label. |
| Empty | Distinguish no transactions, no budget set, filtered-empty, and no categories. Offer the relevant action only. |
| Error | Keep last successful data labeled stale where available; show retry; do not present failures as zero/missing notes. |
| Saving | Inline pending state and disabled duplicate submission; retain draft. Avoid optimistic authoritative financial totals before commit. |
| Saved | Confirm the affected month(s), return focus, invalidate all dependent views, prove persistence after reload. |
| Conflict | Keep the user's draft, show the newer persisted value, and require a deliberate resolution. |
| Offline | Explain that data may be stale; no silent mutation queue or automatic financial replay. |

### Recommended calculation contract — requires product approval

All rules below apply to identical frozen inputs across summary and drilldown. No source-data recategorization or rewriting accompanies calculation fixes.

| Topic | Proposed rule |
|---|---|
| Month/date | Date-only ledger dates with inclusive month start and exclusive next-month start; no timezone conversion through midnight ISO timestamps. Analysis receives explicit start/end periods. |
| Account scope | Initial Budget scope is all owned accounts contributing under existing reporting rules, including hidden-account history where currently counted. Hiding an account is not a financial exclusion. Do not offer an account-filtered “remaining” against a whole-account plan. Full Transactions can filter accounts independently with its scope clearly labeled. |
| Expense spending/refunds | Net expense spending = negative sum of signed contributions assigned to Expense categories. A refund reduces spending and can make it negative. Never take absolute value per record. |
| Income | Net received income = signed sum assigned to Income categories; reversals reduce it. Planned income and received income are separate. Do not label categorized net activity “cash available.” |
| Transfers/card payments | Exclude only records explicitly classified as non-budget transfers/payment movements by a verified existing rule. Do not infer classification from description/sign or invent transfer pairs. If such a rule is absent, preserve the existing category treatment and expose the ambiguity for review; complete transfer-correction work only after its explicit mapping is approved. Raw account movement can be shown separately in Analysis with a clear label. |
| Splits | The parent contributes once to account movement. Active children contribute to category budgets; never parent plus children. A category drawer shows only its allocation contribution, with full parent context labeled separately. |
| Bank pending | Recommended: exclude provider-pending entries from booked Spent/Received and show Pending amounts separately. This changes current inclusion and needs approval. Pending-to-posted transitions retain identity/edits and count once. |
| Category review | Posted activity with a proposed category remains visible in that category with an “awaiting review” indicator; confirmation changes review state, not amount. Uncategorized activity remains a separate attention total. Do not confuse this with provider-pending activity. |
| Exclusions/source removal | Preserve existing source-removed status and exclude it from normal calculations as today; make it accessible in history. No automatic un-removal or new general exclusion scheme. New archives must be explicitly initiated and reversible. |
| Rollover | Retain cumulative positive and negative Expense carry across years; Income has no carry. Start a category's carry at its first persisted budget month. Within that interval, a missing plan month means zero allocation and its eligible activity still counts. Show earlier activity without inventing earlier budget rows. This corrects gap handling and can change later displayed balances. |
| Remaining | Selected-month budget + prior expense carry − net booked spending. This is category-plan headroom, not a bank balance, credit limit, or a promise of spendable cash. |
| Precision | Calculate with PostgreSQL numeric or integer minor units; round at currency boundaries, not every intermediate step. Respect existing currency metadata; do not silently add unlike currencies. USD-looking formatting alone is not evidence all stored accounts share a currency. |

The transfer/currency inventory may reveal a necessary limitation, not permission to relabel records. The first release can retain documented legacy treatment while displaying that limitation; any proposed correction must have a separately reviewable rule and expected result.

## E. Target architecture and schema proposal

Keep Next/Supabase/React Query. Do not add a second backend, ORM, event bus, or another finance engine.

- **Financial reads:** a canonical owned-transaction contribution view and parameterized aggregate/drilldown functions. SQL remains responsible for database aggregates; TypeScript owns typed contracts, exact display arithmetic, and synthetic reference fixtures. Budget, Analysis, and category drilldowns consume the same inclusion rules.
- **Commands:** narrowly named operations for monthly budget updates, transaction edits/splits/archive, review decisions, and note saves. Validate ownership of every referenced row, expected revision, affected-row count, and idempotency key. Multi-row financial writes commit atomically.
- **Integration adapters:** Plaid, Storage, and AI clients behind injectable interfaces with no network or secret access at module import. Tests fail closed on external access.
- **Client state:** user-scoped query-key factories and common mutation hooks. URL holds navigation scope; component state holds drafts/selection. Budget composes table, summary, attention controls, and a reused transaction editor instead of duplicating financial logic.
- **History:** narrow owned read APIs for archived accounts/transactions, past split values, notes, and reconciliation decisions. Never expose connection tokens or unrelated database tables in this UI.

Suggested boundaries are src/lib/finance, src/lib/commands, src/lib/integrations and src/features/{budget,transactions,reconciliation}. Move code only when the boundary reduces duplication; a folder reshuffle by itself is not a milestone.

### Exact proposed additive changes, subject to schema inventory

These are design proposals, **not executed migrations**. After plan approval, draft DDL against the verified base schema for separate approval before applying it to any existing environment. Do not replay historical migrations against existing data; some already contain data-changing statements.

| Change | Necessity and exact proposed scope | Preservation, validation, recovery |
|---|---|---|
| Read RPCs/views | Add versioned contribution/summary/drilldown functions with explicit user/date/category/status contracts. Adapt existing public read contracts in a later compatibility migration only if caller inventory permits. | No financial-row updates. Compare frozen old/new results against independent expectations; keep old compatible read interfaces until consumers move. One canonical implementation after transition. |
| Edit concurrency/history | Add row_version bigint default 0 to transactions and budgets. Add an owned append-only record_revisions table: id, user_id, entity_type, entity_id, operation_id, prior_version, new_version, prior_values, new_values, created_at. Transactional commands journal explicit future edits and increment versions. | Existing IDs/financial fields unchanged by DDL; no historical backfill or claim to reconstruct lost edits. RLS limits history to its owner; no raw revisions in logs. Fault injection proves edit+journal atomicity. Recovery is a version-checked compensating edit, not deletion. |
| Split/archive retention | Add transactions.archived_at nullable, default NULL. Revised commands update retained child IDs, retain prior values in revisions, and archive removed allocations; new allocations receive new IDs. Effective reads and child queries include only active allocations. | No existing row is archived during migration. Verify all old parent/child links remain, archived allocations stay inspectable, and totals count active children once. Clearing a split must preserve children/history. A compatible rollback reader must understand archived rows. |
| Manual/provider boundaries | Add transactions.manual_override_fields nullable text[] (NULL means historical authority unknown), and provider_pending_transaction_id nullable text where a pending lineage cannot be represented already. Store only needed conflicting provider observations in the revision/operation record, not unbounded raw payloads. | No automatic classification of old fields. Protect historical unknown fields from silent overwrite; stage conflicts. Two-provider-ID/one-transaction lineage must be uniquely/owner validated before enabling. No merge/backfill of old rows. |
| Sync concurrency | Add bank_connections sync_lock_token uuid NULL, sync_lock_until timestamptz NULL, and sync_generation bigint default 0, with narrow service-only acquire/commit/release RPCs. | Existing credentials/cursors remain unchanged on migration. Concurrent and stale-worker tests prove only the current generation commits; expired lease recovery does not rewind committed work. |
| Notes versions | Keep the existing bucket and current object paths readable. Before a future explicit overwrite/clear, preserve the previous bytes under a versioned path; journal object reference/hash and operation state in record_revisions. A clear hides the current note without deleting the historical object. | No bulk object move/delete. Storage/database cannot share a transaction: use a staged operation with retry-safe completion, and never replace current content until prior bytes are retained. Verify object hashes, failed saves, and restoration in isolation. |

No category taxonomy migration, recurring-default table, transfer-pair backfill, full ledger rewrite, dropped column/table, or deletion of applied migrations is proposed. Additional grants/indexes require exact DDL and synthetic query/ownership evidence. If live schema already provides these mechanisms, reuse them rather than adding duplicates.

Additive schema does not automatically make every old application binary safe. A compatibility build must understand archives/revisions and write safely before those commands are enabled. Once v2-only writes exist, rolling back to untouched v1 is not assumed safe; F defines the required rollback candidate.

## F. Data preservation, verification, and release

### Recovery readiness before any separately approved existing-data operation

1. **Identify boundaries:** verify the actual Supabase project, database version/schemas, migration ledger, Auth configuration, Storage buckets, functions/triggers/jobs, and other apps sharing the database. Record identifiers privately; put only sanitized completion evidence in Git. Inventory local statements/reports/receipts without opening or copying financial contents into the repository.
2. **Create a coordinated recovery point:** retain a supported database backup covering application and auth records/relationships, plus required roles/grants/extensions/configuration. Back up actual Storage object bytes and metadata, including every note version, separately. Supabase explicitly states that database backups do not include Storage object contents; see [backup documentation](https://supabase.com/docs/guides/platform/backups). Confirm plan-specific backup/PITR availability rather than assuming it.
3. **Protect external/local state:** securely record integration/configuration recovery requirements, approved secret references, OAuth redirect configuration, cron/webhook settings, and local financial inputs/receipts. Do not commit tokens, database dumps, auth exports, account IDs, filenames revealing private data, or raw financial snapshots. Do not rotate credentials or disconnect services for this audit.
4. **Restore and prove:** restore into a new explicitly disposable environment with outgoing Plaid/AI/email/webhook/cron activity blocked, separate credentials, and restricted access. Verify schema, auth ownership, foreign keys, representative records, object byte hashes, and read access using designated test identities. Record backup time, restore time, checks, and outcome privately. A backup existing in a dashboard is not a completed restore drill.
5. **Approve the exact operation:** review the proposed SQL/data scope and recovery evidence. Capture a fresh checkpoint appropriate to that operation. Only then perform the separately authorized work. Do not reset/reseed any existing environment.

A Git checkpoint protects code only. A restore drill is still pending and was not attempted in this audit.

### Integrity baseline and frozen comparisons

Use a protected consistent snapshot for old/new comparison. Prefer two isolated clones of the same recovery point with outbound integrations blocked. Do not compare two sequential live queries while sync continues, and do not pause production jobs without permission.

The baseline must include:

- Exact record-ID sets by table and owner, not just counts; parent/child, account/category, connection, review/candidate, and note-object relationships.
- Important field-level values or keyed integrity digests: signed amounts, date, owner, category/account, budget month/limit, status/review state, hidden flags, descriptions/manual edits, source/provenance, provider identifiers/cursors, and note bytes.
- Signed sums by account/month/category; separate parent cash movements from category allocations; posted/pending/removed and hidden/retired slices; split-cent conservation and orphan checks.
- Auth user-to-row ownership and access tests; existing grants/policies and migration identifiers; object key sets and hashes.
- Existing unrelated/shared data retained within the recovery boundary. No transformations merely because an anomaly is discovered.

Private digests/snapshots belong in controlled storage. Public/committed evidence contains synthetic cases and pass/fail counts only. Do not use unsalted public hashes of low-entropy financial fields as “anonymization.”

For pure UI/refactor changes, all baseline identities, relationships, and field values must match. For approved calculations, only documented derived outputs may differ. For explicit test edits, the expected changed IDs/fields and journal entries must be enumerated; everything else must match.

### Independent financial and workflow acceptance cases

These fixtures are proposed acceptance tests, not claims about production data:

| Case | Independently expected result |
|---|---|
| Refund | Expense -100 plus same-category refund +25 → Spent 75. Budget 200, no carry → Remaining 125. |
| Income reversal | Income +1,000 and reversal -50 → Received 950; not 1,050. |
| Split | Parent -120 with children -70/-50 → account outflow 120, category spend 70/50; selected drawer sums 70, not 120 or 190. |
| Carry across a year | December budget 100/spend 80 → January opening carry 20. January budget 150/spend 180 → closing -10. |
| Gap month | After closing -10, a month with no budget row and spend 30 → closing -40; no row is created. Following budget 100/spend 0 → Remaining 60. |
| No plan/zero budget | Activity remains visible; -40 with zero availability → “Over by 40,” never a normal 100% indicator. |
| Provider pending | Pending -20 → booked spend 0/pending 20; posting → booked 20/pending 0, same preserved logical transaction and edits. |
| Transfers | An explicitly identified -300/+300 internal transfer → budget income/expense 0; account movement retained. Ambiguous transactions remain unmodified and documented. |
| Precision/dates | Split cents sum exactly; leap day and Dec/Jan boundaries land in one month; timezone does not shift a ledger date. |
| Scope and size | Aggregate equals all contributing drilldown pages across >5,000 generated rows, with refunds, splits, archived/hidden records, and two users. |

Before refactoring, add characterization tests for behavior that should stay and independent expected-result tests for approved corrections. Do not simply snapshot today's bugs.

Persistence/E2E coverage must include selected-month and explicit future edits after reload; stale save conflicts; transaction category/account/date/description edits and Not a Duplicate; note save/clear/failure/history; split edit/unsplit retention; all search filters/pagination; AI scoped batch success/zero/partial/error/cancel; statement decision idempotency; active Accounts/Analysis/reconciliation workflows; login/reset/sign-out and cross-user/cross-tab isolation.

Integration tests must cover repeated imports/sync pages, conflicting external IDs, pending-to-posted lineage, changed provider amounts on split parents, cursor/page failures, duplicate webhooks, concurrent runs, transient versus reconnect errors, and unavailable providers. All inputs and servers are synthetic. A test fails if it attempts an unapproved network destination.

For migrations, test fresh synthetic schema creation, upgrade from the verified baseline, unchanged existing values, both application compatibility builds, RLS/grants, and failure recovery. Never test migration rollback by deleting valuable data.

### Candidate and release gates

After approval, create a dedicated v2 branch/worktree from the verified baseline, preserve the original commit, and append enduring safety/verification rules to AGENTS.md without overwriting deployment instructions. Keep small commits separated by cleanup, calculations, dependencies, safe mutations, and UI.

Use an isolated preview with different credentials and provider fakes. Authentication, successful reload persistence, desktop/mobile E2E, full lint/type/tests/build, and a complete v2-to-baseline diff review are required. No private screenshots, logs, statements, or fixtures.

Prepare release notes with the approved calculation differences, a feature-parity checklist, actual command outputs, remaining limitations, exact schema approvals, and a rollback rehearsal. Production remains a separate approval.

Rollback means deploying a tested compatible application build, disabling a defective new command through an authorized control if needed, and retaining all data written since launch. Leave additive schema/history in place. Apply a reviewed forward fix or version-checked compensating operation when required. **Restoring an old database over current data or deleting a statement batch is not a lossless release rollback.** If disaster recovery is needed, restore alongside current state and reconcile approved differences without overwriting newer records.

When release is explicitly approved, follow repository instructions: npm run lint, npm run build, commit intended changes, push origin/main, stop. Do not interact with Vercel directly.

## G. Ordered implementation milestones

Each milestone ends with actual checks, a brief evidence report, and a reviewable commit. A failure triggers a concrete fix or stated blocker, not a new open-ended audit.

| Milestone | User benefit and bounded scope | Dependencies / risk | Acceptance criteria | Schema/data implications |
|---|---|---|---|---|
| **0. Establish the safe development baseline** | Choose the verified Git baseline; create v2 worktree; preserve source differences; append safety rules; pin working runtime/tooling; construct isolated synthetic environment and test command. | Plan approval. Medium risk from missing schema and remote evidence. | Remote/main/deployed relationship recorded read-only; no existing changes lost; test/build environment cannot reach production; complete schema provenance documented or exact missing objects identified. | No existing-data operation. Draft/import schema only into a newly designated disposable environment; recovery drill requires separate authorized backup access. |
| **1. Lock financial contracts and close exposed safety paths** | Add failing regression cases for F1/F4/F6–8/F11/F14; make Budget reads pure; fix AI serialization/auth redirects; implement mocked webhook verification; targeted framework patch in its own commit. | M0 and approval of D's calculation rules. Medium risk to auth/integration compatibility. | Synthetic financial expectations are explicit; GET/navigation changes no records; AI boundary updates only expected owned rows; forged webhook rejected; login/reset works; lint/type/build and focused tests pass. | Read/query and code changes; additive read-RPC DDL may be drafted. No live RPC/config update. |
| **2. Make edits preserve history and survive failures** | Atomic monthly edits with scope preview; stable split IDs/archive; manual-field protection; note versions; affected-row/conflict handling; sync lease and recoverable operation results. | M1; exact schema design/recovery review. High risk because persistence behavior changes. | No delete-and-recreate path remains in enabled financial commands; before/after identities/links and notes preserved; failures/retries/concurrency tested; no silent provider overwrite. | Proposed E additions in disposable tests only until separate existing-environment approval. No old-data backfill/merge/recategorization. |
| **3. Unify financial reads and query state** | Canonical contribution/aggregate/drilldown contracts for Budget and Analysis; pagination/summary fixes; shared query keys and invalidation. | M1 financial tests, M2 retention semantics. High risk of changed historical displayed totals. | All independent cases pass; frozen comparisons explain every difference; selected totals equal full drilldowns; >5,000-row and two-user cases pass; no persistent changes on reads. | Additive read functions/index proposals as justified; approval before existing-environment DDL. No source-data transformations. |
| **4. Build the monthly Budget workspace** | Replace Plan/Activity with the structure/flows in D; inline monthly editing; category drawer; context-preserving review; desktop/mobile/keyboard states. | M2–3 contracts and commands. Medium interaction risk. | Five core Budget questions answerable in one workspace; selected context survives edit/reload/back; zero-budget overspend and refunds clear; responsive and keyboard E2E pass. | Uses approved commands. UI itself requires no new schema, category migration, or historical budget creation. |
| **5. Complete parity and verified cleanup** | Keep all Transactions, Accounts, Analysis, reconciliation, AI and Plaid workflows; add accessible history; fix remaining error/caching gaps; remove only verified obsolete code in separate commits. | M4; caller checks for uncertain tools. Medium risk of missed external consumers. | Feature disposition reconciled with full diff; every active workflow tested with fakes; retired history reachable; removal ledger cites evidence; uncertain endpoints/tools retained by default. | No data/schema deletion. Any missing history read permissions are exact, separately reviewed changes. |
| **6. Produce the release candidate** | Full isolated regression, complete diff/security/data-loss review, recovery/compatibility rollback rehearsal, release notes and evidence bundle. | M0–5 and all required recovery/schema approvals. High consequence, bounded verification scope. | Lint/type/financial/API/E2E/build pass; integrity checks pass; restore and post-launch-write-preserving rollback demonstrated; no unresolved critical/high release blocker; candidate ready for your review. | No production release or migration by plan approval. Present exact deployment/schema operations for separate authorization. |

### Decisions needed now

1. **Approve the product direction:** unified monthly Budget, in-place category review, and selected-month-only edits by default, with explicit selected future months. Keep the active feature set and existing stack.
2. **Approve the proposed calculation corrections:** net refunds/reversals, provider-pending shown separately from booked totals, visible unplanned activity, and cumulative expense rollover including zero-allocation gap months. Keep existing classifications and flag unresolved transfers/currencies instead of changing records automatically.

Uncertain HTTP/maintenance-tool retirements default to **retain**, so they do not block starting approved work. Schema execution, operations against existing data, real integration activity, and production release all remain separate approvals.

**Implementation approved. Existing-data operations and production release require separate approval. See the progress document for subsequent evidence.**
