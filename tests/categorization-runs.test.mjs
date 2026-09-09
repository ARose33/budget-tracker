import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  createTestDatabase,
  asUser,
  userA,
  userB,
} from "./support/database.mjs";
async function setup() {
  const db = await createTestDatabase();
  await db.query("insert into auth.users(id) values ($1),($2)", [userA, userB]);
  for (const name of ["01-preservation", "08-categorization"])
    await db.exec(
      await fs.readFile(
        new URL("../supabase/proposals/" + name + ".sql", import.meta.url),
        "utf8",
      ),
    );
  const category = (
    await db.query(
      "insert into budget_categories(group_name,line_item_name,category_type,user_id) values ('Everyday','Food','Expense',$1) returning id",
      [userA],
    )
  ).rows[0].id;
  const ids = (
    await db.query(
      "insert into transactions(date,description,amount,user_id) values ('2026-09-01','First synthetic merchant',-10,$1),('2026-09-02','Second synthetic merchant',-20,$1) returning id",
      [userA],
    )
  ).rows.map((row) => row.id);
  await asUser(db, userA);
  const begin = async (id, token) =>
    (
      await db.query("select stackmint_begin_categorization($1,$2) as result", [
        id,
        token,
      ])
    ).rows[0].result;
  const finish = async (id, token, items = null) =>
    (
      await db.query(
        "select stackmint_finish_categorization($1,$2,$3::jsonb) as result",
        [id, token, items === null ? null : JSON.stringify(items)],
      )
    ).rows[0].result;
  return { db, category, ids, begin, finish };
}
test("categorization preserves concurrent edits, counts actual writes and returns the same receipt on retry", async () => {
  const { db, category, ids, begin, finish } = await setup();
  try {
    const id = randomUUID(),
      token = randomUUID();
    assert.equal((await begin(id, token)).candidates.length, 2);
    await assert.rejects(begin(randomUUID(), randomUUID()), /still running/);
    await db.query(
      'select stackmint_edit_transactions($1::jsonb,\'{"description":"My concurrent edit"}\')',
      [JSON.stringify([{ id: ids[0], version: 0 }])],
    );
    const items = ids.map((transaction_id, i) => ({
      transaction_id,
      category_id: category,
      source: i ? "model" : "history",
    }));
    const result = await finish(id, token, items);
    assert.deepEqual(result, {
      processed: 1,
      matchedFromHistory: 0,
      inferredByModel: 1,
      skipped: 1,
      remaining: 1,
      done: false,
      queuedAtStart: 2,
    });
    assert.deepEqual(await finish(id, token, items), result);
    assert.deepEqual((await begin(id, randomUUID())).result, result);
    const row = (
      await db.query(
        "select description,category_id from transactions where id=$1",
        [ids[0]],
      )
    ).rows[0];
    assert.equal(row.description, "My concurrent edit");
    assert.equal(row.category_id, null);
    await asUser(db, userB);
    await assert.rejects(finish(id, token, items), /unavailable/);
    assert.equal(
      (await db.query("select * from categorization_runs")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
test("invalid or failed categorization batches cannot partially commit and stale workers are fenced", async () => {
  const { db, category, ids, begin, finish } = await setup();
  try {
    const id = randomUUID(),
      token = randomUUID();
    await begin(id, token);
    await assert.rejects(
      finish(id, token, [
        { transaction_id: ids[0], category_id: category, source: "history" },
        { transaction_id: ids[1], category_id: randomUUID(), source: "model" },
      ]),
      /Invalid assignment/,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from transactions where category_id is not null",
        )
      ).rows[0].n,
      0,
    );
    await finish(id, token);
    const replacement = randomUUID();
    await begin(id, replacement);
    await assert.rejects(finish(id, token, []), /lease/);
    await finish(id, replacement, []);
    await assert.rejects(
      db.query("update categorization_runs set candidates='[]'"),
      /permission/,
    );
  } finally {
    await db.close();
  }
});
test("automatic categorization excludes archived, split and bank-pending records and ambiguous or reversed-sign history", async () => {
  const { db, category, ids, begin } = await setup();
  try {
    await db.query(
      "select stackmint_edit_transactions($1::jsonb,'{\"archived\":true}')",
      [JSON.stringify([{ id: ids[0], version: 0 }])],
    );
    await db.query(
      "update transactions set external_status='pending' where id=$1",
      [ids[1]],
    );
    assert.equal(
      (await begin(randomUUID(), randomUUID())).candidates.length,
      0,
    );
    await db.exec("reset role");
    const history = (
      await db.query(
        "insert into transactions(date,description,amount,user_id,category_id,categorization_status) values ('2026-08-01','same merchant',-5,$1,$2,'final') returning id",
        [userA, category],
      )
    ).rows[0].id;
    const candidates = (
      await db.query(
        "insert into transactions(date,description,amount,user_id) values ('2026-09-03','same merchant',-15,$1),('2026-09-03','same merchant',15,$1) returning id",
        [userA],
      )
    ).rows;
    await asUser(db, userA);
    const matches = async () =>
      (
        await db.query(
          "select stackmint_categorization_matches($1::uuid[]) as result",
          [candidates.map((row) => row.id)],
        )
      ).rows[0].result;
    assert.deepEqual(await matches(), [
      { transaction_id: candidates[0].id, category_id: category },
    ]);
    await db.query("update transactions set archived_at=now() where id=$1", [
      history,
    ]);
    assert.deepEqual(await matches(), []);
  } finally {
    await db.close();
  }
});
