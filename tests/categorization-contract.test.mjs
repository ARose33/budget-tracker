import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, asUser, userA, userB } from "./support/database.mjs";
import { applyCategorizationAssignments } from "../src/lib/ai/transaction-categorization.ts";
import { POST as legacyClaim } from "../src/app/api/auth/claim-legacy-data/route.ts";

test("AI assignments cross the real PostgreSQL JSON contract, preserve prior categories, and isolate owners", async () => {
  const db = await createTestDatabase();
  try {
    await db.query("insert into auth.users(id) values ($1),($2)", [userA,userB]);
    await asUser(db,userB);
    const foreignCategory = (await db.query("insert into public.budget_categories(group_name,line_item_name,category_type) values ('Other','Synthetic','Expense') returning id")).rows[0].id;
    await asUser(db,userA);
    const category = (await db.query("insert into public.budget_categories(group_name,line_item_name,category_type) values ('Everyday','Synthetic','Expense') returning id")).rows[0].id;
    const transaction = (await db.query("insert into public.transactions(date,description,amount) values ('2026-09-05','Synthetic purchase',-12) returning id")).rows[0].id;
    const apply = (items) => db.query("select public.apply_transaction_categorizations($1::jsonb) as changed", [JSON.stringify(items)]).then(r => Number(r.rows[0].changed));
    assert.equal(await applyCategorizationAssignments([{transactionId: transaction,categoryId: foreignCategory}], apply), 0);
    assert.equal(await applyCategorizationAssignments([{transactionId: transaction,categoryId: category}], apply), 1);
    assert.equal(await applyCategorizationAssignments([{transactionId: transaction,categoryId: category}], apply), 0);
    const stored=(await db.query("select id,category_id,categorization_status from public.transactions where id=$1",[transaction])).rows[0];
    assert.equal(stored.id,transaction);
    assert.equal(stored.category_id,category);
    assert.equal(stored.categorization_status,"pending");
    await asUser(db,userB);
    assert.equal(await applyCategorizationAssignments([{transactionId: transaction,categoryId: foreignCategory}], apply),0);
  } finally { await db.close(); }
});
test("retired legacy claim cannot make ownership writes even when the old flag is enabled", async () => {
  const original=process.env.ALLOW_LEGACY_DATA_CLAIM;
  process.env.ALLOW_LEGACY_DATA_CLAIM="true";
  try {
    const response=await legacyClaim();
    assert.equal(response.status,410);
    assert.match((await response.json()).error,/not been changed/);
  } finally {
    if(original===undefined)delete process.env.ALLOW_LEGACY_DATA_CLAIM;
    else process.env.ALLOW_LEGACY_DATA_CLAIM=original;
  }
});
