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
