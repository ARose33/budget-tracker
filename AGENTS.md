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
4. Deploy through GitHub:
   - Commit only the intended release scope.
   - Push a release branch to `origin`.
   - Open and merge a pull request into `master`.
   - The Vercel GitHub integration deploys `master` to production automatically.
5. Monitor the Vercel commit status through GitHub until it succeeds or fails.
6. Verify the production URL or a feature-specific production endpoint. A successful build, commit, push, PR merge, or pending deployment is not proof that the feature is live.
7. Report “live” only after the GitHub-triggered production deployment succeeds and production verification passes.

Do not require Vercel CLI authentication for routine deployments. Use the GitHub commit status and deployment checks as the source of truth for the GitHub-triggered Vercel deployment.
