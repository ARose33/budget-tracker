import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createTestDatabase, asUser, userA } from "./support/database.mjs";

test("stale hosted commands return a non-retryable conflict and retain the winning budget", async () => {
  const db = await createTestDatabase();
  try {
    await db.query("insert into auth.users(id) values ($1)", [userA]);
    const directory = new URL("../supabase/proposals/", import.meta.url);
    for (const file of (await fs.readdir(directory)).filter((name) => /^\d{2}-.+\.sql$/.test(name)).sort())
      await db.exec(await fs.readFile(new URL(file, directory), "utf8"));
    await db.exec(await fs.readFile(new URL("../supabase/migrations/20260913185712_stackmint_v2_http_conflicts.sql", import.meta.url), "utf8"));
    assert.equal((await db.query("select count(*)::int as remaining from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'stackmint_%' and p.prosrc like '%40001%'")).rows[0].remaining, 0);
    await asUser(db, userA);
    const id = randomUUID();
    await db.query("select stackmint_category($1::jsonb)", [JSON.stringify({ action: "create", id, group_name: "Synthetic", line_item_name: "Budget", category_type: "Expense", year: 2030, month: 1, budget_limit: 100 })]);
    const edit = JSON.stringify([{ category_id: id, year: 2030, month: 1, budget_limit: 200, expected_version: 0 }]);
    await db.query("select stackmint_save_budgets($1::jsonb)", [edit]);
    await assert.rejects(db.query("select stackmint_save_budgets($1::jsonb)", [edit]), (error) => error.code === "PT409" && /budget changed/.test(error.message));
    const saved = (await db.query("select budget_limit,row_version::int from budgets where category_id=$1", [id])).rows[0];
    assert.equal(Number(saved.budget_limit), 200);
    assert.equal(saved.row_version, 1);
  } finally { await db.close(); }
});
