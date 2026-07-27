<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Production deployment

When the user says to deploy, publish, push live, or asks whether a change is live:

1. Treat deployment as part of the requested task. Do not stop after a local build or Git push.
2. Run `npm run lint` and `npm run build`.
3. Apply required Supabase infrastructure before deploying the UI:
   - Prefer existing authenticated server APIs and private Storage for app data that does not require relational querying.
   - For SQL migrations, use the linked Supabase CLI/project credential when available and verify the resulting schema through the API.
   - Never deploy code that selects a column before confirming that column exists in production.
4. Run `powershell -ExecutionPolicy Bypass -File scripts/deploy-production.ps1`.
5. Verify the production URL or a feature-specific production endpoint. A successful build, commit, push, or deployment command is not proof that the feature is live.
6. Report “live” only after production verification succeeds.

The Vercel project is already linked by `.vercel/project.json`. Use the standard Vercel CLI credential location; do not default to dashboard login or assume that pushing `master` triggered a deployment. If authentication is unavailable, report that exact credential prerequisite rather than instructing the user to perform unrelated Supabase/Vercel dashboard steps.
