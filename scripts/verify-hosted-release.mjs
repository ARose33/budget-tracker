// Explicitly limited to the disposable restored project. Credentials arrive on stdin.
import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";

const projectRef = "blazhzqrxwwugvunkmud";
const origin = `https://${projectRef}.supabase.co`;
let phase = "configuration";
const checks = [];
function requireResult(result) {
  if (result.error) {
    const code = String(result.error.code ?? result.status ?? "request_failed");
    throw new Error(/^[a-zA-Z0-9_]{1,40}$/.test(code) ? code : "request_failed");
  }
  return result.data;
}
function check(condition) { if (!condition) throw new Error("assertion_failed"); }
function options(headers = {}) {
  return {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      headers,
      fetch: (input, init) => {
        if (new URL(typeof input === "string" ? input : input.url).origin !== origin)
          throw new Error("unexpected_destination");
        return fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(30000) });
      },
    },
  };
}

try {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const credentials = JSON.parse(input);
  check(credentials.projectRef === projectRef && credentials.serviceKey && credentials.anonKey);
  const headers = { "x-stackmint-version": "2" };
  const admin = createClient(origin, credentials.serviceKey, options(headers));

  phase = "restored user authentication";
  const owners = requireResult(await admin.from("transactions").select("user_id").not("user_id", "is", null).limit(1));
  check(owners.length === 1);
  const originalUser = requireResult(await admin.auth.admin.getUserById(owners[0].user_id)).user;
  check(originalUser?.email);
  // Generates a test login token locally in this project; it sends no email.
  const link = requireResult(await admin.auth.admin.generateLink({ type: "magiclink", email: originalUser.email }));
  const restoredUser = createClient(origin, credentials.anonKey, options(headers));
  const restoredSession = requireResult(await restoredUser.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" }));
  check(restoredSession.user.id === owners[0].user_id);
  checks.push(phase);

  phase = "restored ledger reads";
  for (const [name, params] of [
    ["stackmint_budget", { p_year: 2026, p_month: 9 }],
    ["stackmint_budget_activity", { p_year: 2026, p_month: 9 }],
    ["stackmint_transactions", {}],
    ["stackmint_analysis", { p_from: "2026-01-01", p_to: "2027-01-01" }],
  ]) check(requireResult(await restoredUser.rpc(name, params)) !== null);
  checks.push(phase);

  phase = "synthetic user authentication";
  const email = `rollout-${randomUUID()}@stackmint.test`;
  const password = randomBytes(32).toString("base64url");
  const synthetic = requireResult(await admin.auth.admin.createUser({ email, password, email_confirm: true }));
  const user = createClient(origin, credentials.anonKey, options(headers));
  const login = requireResult(await user.auth.signInWithPassword({ email, password }));
  check(login.user.id === synthetic.user.id);
  checks.push(phase);

  phase = "cross user isolation";
  check(requireResult(await user.from("transactions").select("id").limit(1)).length === 0);
  check(requireResult(await user.from("budget_categories").select("id").eq("user_id", originalUser.id).limit(1)).length === 0);
  checks.push(phase);

  const categoryId = randomUUID();
  const command = { action: "create", id: categoryId, group_name: "Rollout verification", line_item_name: "Synthetic category", category_type: "Expense", year: 2030, month: 1, budget_limit: 100 };
  phase = "legacy writer rejection";
  const legacy = createClient(origin, credentials.anonKey, options());
  requireResult(await legacy.auth.setSession({ access_token: login.session.access_token, refresh_token: login.session.refresh_token }));
  const rejected = await legacy.rpc("stackmint_category", { p_command: command });
  check(rejected.error?.code === "42501");
  check(requireResult(await user.from("budget_categories").select("id").eq("id", categoryId)).length === 0);
  checks.push(phase);

  phase = "current writer persistence";
  check(requireResult(await user.rpc("stackmint_category", { p_command: command })) === categoryId);
  const first = requireResult(await user.from("budgets").select("budget_limit,row_version").eq("category_id", categoryId).single());
  check(Number(first.budget_limit) === 100 && Number(first.row_version) === 0);
  checks.push(phase);

  phase = "concurrent edits";
  const competing = createClient(origin, credentials.anonKey, options(headers));
  requireResult(await competing.auth.setSession({ access_token: login.session.access_token, refresh_token: login.session.refresh_token }));
  const results = await Promise.all([user, competing].map((client, index) => client.rpc("stackmint_save_budgets", {
    p_edits: [{ category_id: categoryId, year: 2030, month: 1, budget_limit: 200 + index, expected_version: 0 }],
  })));
  if (results.filter((result) => !result.error).length !== 1 || results.filter((result) => result.error?.code === "PT409" && result.status === 409).length !== 1)
    throw new Error("outcomes_" + results.map((result) => result.error ? (result.error.code || `http${result.status}_${/budget changed/i.test(result.error.message) ? "stale" : /timeout|abort/i.test(result.error.message) ? "timeout" : /fetch failed/i.test(result.error.message) ? "fetch" : "error"}`) : "success").join("_"));
  phase = "concurrent edit saved version";
  const saved = requireResult(await user.from("budgets").select("budget_limit,row_version").eq("category_id", categoryId).single());
  check(Number(saved.row_version) === 1 && [200, 201].includes(Number(saved.budget_limit)));
  phase = "concurrent edit budget reload";
  const budget = requireResult(await user.rpc("stackmint_budget", { p_year: 2030, p_month: 1 }));
  check(budget.items.some((item) => item.category_id === categoryId && Number(item.budget_limit) === Number(saved.budget_limit)));
  phase = "concurrent edit isolation";
  check(requireResult(await restoredUser.from("budget_categories").select("id").eq("id", categoryId)).length === 0);
  checks.push("concurrent edits");
  console.log(JSON.stringify({ verified: true, projectRef, checks }));
} catch (error) {
  // Never serialize SDK errors or response bodies: they may contain private data.
  const code = /^[a-zA-Z0-9_]{1,40}$/.test(error.message) ? error.message : "request_failed";
  console.log(JSON.stringify({ verified: false, phase, code }));
  process.exitCode = 1;
}
