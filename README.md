This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

This repository is linked to the production Vercel project through
`.vercel/project.json`. Deployments must use the checked-in helper:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/deploy-production.ps1
```

The helper verifies Vercel CLI authentication, builds the application, deploys
to production, and confirms that the production URL responds. A Git push alone
must not be treated as a completed deployment.

If a release introduces a Supabase schema migration, apply and verify that
migration before running the Vercel helper. Never release frontend code that
queries a production column that has not been confirmed through the Supabase
API.
