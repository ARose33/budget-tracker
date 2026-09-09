import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  createTestDatabase,
  asUser,
  userA,
  userB,
} from "./support/database.mjs";
async function fixture() {
  const db = await createTestDatabase();
  await db.query("insert into auth.users(id) values ($1),($2)", [userA, userB]);
  await asUser(db, userA);
  const account = (
    await db.query(
      "insert into accounts(name,institution,type) values ('Synthetic checking','Fixture bank','Checking') returning id",
    )
  ).rows[0].id;
  const cats = (
    await db.query(
      "insert into budget_categories(group_name,line_item_name,category_type) values ('Everyday','Groceries','Expense'),('Everyday','Transport','Expense') returning id",
    )
  ).rows.map((r) => r.id);
  const parent = (
    await db.query(
      "insert into transactions(date,description,amount,account_id) values ('2026-09-01','Synthetic split',-120,$1) returning id",
      [account],
    )
  ).rows[0].id;
  const before = (
    await db.query("select to_jsonb(t) as value from transactions t")
  ).rows;
  await db.exec("reset role");
  await db.exec(
    await fs.readFile(
      new URL("../supabase/proposals/01-preservation.sql", import.meta.url),
      "utf8",
    ),
  );
  await asUser(db, userA);
  return { db, account, cats, parent, before };
}
test("additive proposal preserves all original transaction fields and makes no historical journal entries", async () => {
  const { db, before } = await fixture();
  try {
    const after = (
      await db.query("select to_jsonb(t) as value from transactions t")
    ).rows;
    for (let i = 0; i < before.length; i++)
      for (const [key, value] of Object.entries(before[i].value))
        assert.deepEqual(after[i].value[key], value);
    assert.equal(
      (await db.query("select count(*)::int as count from record_revisions"))
        .rows[0].count,
      0,
    );
    await assert.rejects(
      db.query("delete from transactions"),
      /permission|retained/i,
    );
    await assert.rejects(
      db.query("select access_token from bank_connections"),
      /permission/i,
    );
    assert.equal(
      (await db.query("select id,status from bank_connections")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
test("budget edits are exact in scope, preserve IDs, and fail atomically on stale versions", async () => {
  const { db, cats } = await fixture();
  try {
    const save = (edits) =>
      db
        .query("select stackmint_save_budgets($1::jsonb) as result", [
          JSON.stringify(edits),
        ])
        .then((r) => r.rows[0].result);
    const original = await save(
      [9, 10, 11].map((month) => ({
        category_id: cats[0],
        year: 2026,
        month,
        budget_limit: 200,
        expected_version: null,
      })),
    );
    await save([
      {
        category_id: cats[0],
        year: 2026,
        month: 9,
        budget_limit: 250,
        expected_version: 0,
      },
    ]);
    const rows = (
      await db.query(
        "select id,month_number,budget_limit,row_version from budgets order by month_number",
      )
    ).rows;
    assert.deepEqual(
      rows.map((r) => Number(r.budget_limit)),
      [250, 200, 200],
    );
    assert.deepEqual(
      rows.map((r) => r.id),
      original.map((r) => r.id),
    );
    await assert.rejects(
      save([
        {
          category_id: cats[0],
          year: 2026,
          month: 10,
          budget_limit: 300,
          expected_version: 0,
        },
        {
          category_id: cats[0],
          year: 2026,
          month: 11,
          budget_limit: 300,
          expected_version: 99,
        },
      ]),
      /changed/,
    );
    assert.equal(
      Number(
        (
          await db.query(
            "select budget_limit from budgets where month_number=10",
          )
        ).rows[0].budget_limit,
      ),
      200,
    );
    await assert.rejects(
      save([
        {
          category_id: cats[0],
          year: 2026,
          month: 9,
          budget_limit: 300,
          expected_version: 0,
        },
      ]),
      /changed/,
    );
  } finally {
    await db.close();
  }
});
test("split edits and unsplit retain child identities, previous values, and all relationships", async () => {
  const { db, cats, parent } = await fixture();
  try {
    const save = (version, allocations) =>
      db
        .query("select stackmint_save_split($1,$2,$3::jsonb) as result", [
          parent,
          version,
          JSON.stringify(allocations),
        ])
        .then((r) => r.rows[0].result);
    await save(0, [
      { category_id: cats[0], amount: -70 },
      { category_id: cats[1], amount: -50 },
    ]);
    const children = (
      await db.query(
        "select id,category_id,amount from transactions where parent_id=$1 order by amount",
        [parent],
      )
    ).rows;
    await save(1, [
      { ...children[0], amount: -65 },
      { ...children[1], amount: -55 },
    ]);
    assert.deepEqual(
      (
        await db.query(
          "select id from transactions where parent_id=$1 order by amount",
          [parent],
        )
      ).rows.map((r) => r.id),
      children.map((r) => r.id),
    );
    await assert.rejects(
      save(1, [
        { ...children[0], amount: -65 },
        { ...children[1], amount: -55 },
      ]),
      /changed/,
    );
    await db.query("select stackmint_unsplit($1,2)", [parent]);
    const retained = (
      await db.query(
        "select id,parent_id,archived_at from transactions where parent_id=$1",
        [parent],
      )
    ).rows;
    assert.equal(retained.length, 2);
    assert.ok(retained.every((r) => r.archived_at && r.parent_id === parent));
    const revisions = (
      await db.query(
        "select prior_values from record_revisions where entity_id=$1 and prior_values is not null order by created_at",
        [children[0].id],
      )
    ).rows;
    assert.ok(
      revisions.some(
        (r) => Number(r.prior_values.amount) === Number(children[0].amount),
      ),
    );
  } finally {
    await db.close();
  }
});
test("transaction edits preserve unknown manual authority, support reversible archive, and reject foreign references", async () => {
  const { db, cats, parent } = await fixture();
  try {
    const edit = (version, patch) =>
      db
        .query(
          "select stackmint_edit_transactions($1::jsonb,$2::jsonb) as result",
          [JSON.stringify([{ id: parent, version }]), JSON.stringify(patch)],
        )
        .then((r) => r.rows[0].result[0]);
    const changed = await edit(0, {
      description: "Explicit synthetic correction",
      category_id: cats[0],
    });
    assert.equal(changed.description, "Explicit synthetic correction");
    assert.ok(changed.manual_override_fields.includes("*"));
    assert.ok(changed.manual_override_fields.includes("description"));
    await asUser(db, userB);
    const foreign = (
      await db.query(
        "insert into budget_categories(group_name,line_item_name,category_type) values ('Foreign','Synthetic','Expense') returning id",
      )
    ).rows[0].id;
    assert.equal(
      (
        await db.query("select * from record_revisions where user_id=$1", [
          userA,
        ])
      ).rows.length,
      0,
    );
    await asUser(db, userA);
    await assert.rejects(edit(1, { category_id: foreign }), /owned/);
    assert.equal((await edit(1, { archived: true })).id, parent);
    assert.equal((await edit(2, { archived: false })).archived_at, null);
    assert.equal(
      (await db.query("select count(*)::int as count from transactions"))
        .rows[0].count,
      1,
    );
  } finally {
    await db.close();
  }
});
