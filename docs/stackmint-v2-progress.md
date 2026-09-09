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

Milestones 1–6 remain in progress. Existing-environment schema execution, a verified backup/restore drill, deployed-schema compatibility, real integration configuration, full browser verification, and release approval remain pending. Development approval does not authorize those existing-data/production operations. No production writes, migrations, integration calls, or deployment have occurred.
