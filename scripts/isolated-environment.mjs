import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export function isolatedEnvironment(extra = {}) {
  // Never inherit application/provider credentials. No .env file is read here.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !/SUPABASE|PLAID|OPENAI|CRON_SECRET|WEBHOOK_SECRET|LEGACY_DATA|DATABASE_URL|PGPASSWORD|^NEXT_PUBLIC_|^STACKMINT_|^NODE_OPTIONS$/.test(
          name,
        ),
    ),
  );
  return {
    ...env,
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key",
    NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000",
    OPENAI_API_KEY: "synthetic-disabled",
    PLAID_CLIENT_ID: "synthetic-disabled",
    PLAID_SECRET: "synthetic-disabled",
    PLAID_ENV: "sandbox",
    ALLOW_LEGACY_DATA_CLAIM: "false",
    NEXT_TELEMETRY_DISABLED: "1",
    STACKMINT_ISOLATED: "true",
    STACKMINT_INTEGRATIONS_ENABLED: "false",
    ...extra,
  };
}
export function runNode(args, extra = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: isolatedEnvironment(extra),
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", (error) => {
      console.error(error.message);
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}
