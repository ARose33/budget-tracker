<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Production deployment

When the user says to deploy, publish, or push this app live:

1. Validate the code with the appropriate checks, including `npm run lint` and `npm run build`.
2. Commit the intended changes.
3. Push the commit to `origin/main`.
4. Stop. Do not interact with Vercel directly unless the user explicitly asks to debug a Vercel deployment.

- "Deploy" means commit and push changes to `origin/main`.
- Never use the Vercel CLI.
- Never attempt browser-based authentication with Vercel.
- Vercel automatically deploys from GitHub after a successful push.

## StackMint v2 data safety

- The v2 product direction and calculation rules are approved. Work on the dedicated v2 branch/worktree; no merge or production release without separate approval.
- Preserve all existing records, IDs, relationships, financial values, manual edits, notes/files, integration identifiers, retired-feature data, and applied migration history. Never delete-and-recreate financial records, reset/reseed an existing environment, or silently recategorize, merge, deduplicate, or reimport data.
- No existing-database migration/data operation, production configuration change, real Plaid/AI/import/sync/webhook activity, account disconnection, or credential replacement is authorized by development approval.
- Draft schema changes are reviewed separately before execution against existing data. Require a verified recovery point and an isolated restore drill covering database/Auth, Storage bytes, and other relevant state. Git is not a database backup. Release rollback must preserve writes made after launch.
- Inspect scripts and hooks before installation/build/test/dev commands. Do not load another checkout's environment file. Tests use only generated fixtures and disposable local stores, with external network requests blocked. Never invoke statement maintenance commands as tests.
- Never commit/log private financial inputs, records, account identifiers, raw backups, receipts, screenshots, or secrets. Keep test artifacts synthetic.
- Keep the approved proposal and milestone evidence in docs. Use small separate commits for dependency changes, cleanup, behavior changes, and UI. Review the entire diff against baseline 7097b80b518a52f935f1327b8976de83556716e6 before release.
- Verification commands are documented in docs/stackmint-v2-progress.md. Use the isolated runner for local build/dev/tests; report actual results and unverified scope. Do not disable checks or treat missing fixtures as passing coverage.
