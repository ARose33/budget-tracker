import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  createTestDatabase,
  asUser,
  userA,
  userB,
} from "./support/database.mjs";
async function setup() {
  const db = await createTestDatabase();
  for (const name of [
    "01-preservation",
    "02-finance",
    "03-category-commands",
    "04-transaction-reads",
    "05-note-history",
  ])
    await db.exec(
      await fs.readFile(
        new URL("../supabase/proposals/" + name + ".sql", import.meta.url),
        "utf8",
      ),
    );
  await db.query("insert into auth.users(id) values ($1),($2)", [userA, userB]);
  await asUser(db, userA);
  return db;
}
test("category creation is atomic, bounded to one month and retry-safe; rename keeps identity and checks observed names", async () => {
  const db = await setup();
  try {
    const id = "20000000-0000-4000-8000-000000000011";
    const call = (command) =>
      db.query("select stackmint_category($1::jsonb) as id", [
        JSON.stringify(command),
      ]);
    const command = {
      action: "create",
      id,
      group_name: "Everyday",
      line_item_name: "Groceries",
      category_type: "Expense",
      year: 2026,
      month: 9,
      budget_limit: 250,
    };
    await call(command);
    await call(command);
    assert.equal(
      (await db.query("select count(*)::int as count from budgets")).rows[0]
        .count,
      1,
    );
    const bad = {
      ...command,
      id: "20000000-0000-4000-8000-000000000012",
      line_item_name: "Travel",
      budget_limit: -1,
    };
    await assert.rejects(call(bad), /amount|budget/i);
    assert.equal(
      (await db.query("select count(*)::int as count from budget_categories"))
        .rows[0].count,
      1,
    );
    await call({
      ...command,
      action: "rename",
      expected_group: "Everyday",
      expected_item: "Groceries",
      line_item_name: "Food",
    });
    await assert.rejects(
      call({
        ...command,
        action: "rename",
        expected_group: "Everyday",
        expected_item: "Groceries",
        line_item_name: "Other",
      }),
      /changed/,
    );
    await call({
      ...command,
      action: "rename_group",
      expected_group: "Everyday",
      expected_item: "Food",
      group_name: "Daily",
    });
    const category = (await db.query("select * from budget_categories"))
      .rows[0];
    assert.equal(category.id, id);
    assert.equal(category.group_name, "Daily");
    assert.equal(category.line_item_name, "Food");
    assert.equal(
      Number(
        (await db.query("select budget_limit from budgets")).rows[0]
          .budget_limit,
      ),
      250,
    );
  } finally {
    await db.close();
  }
});
test("transaction search respects simultaneous filters, split membership, archive history and owner boundaries", async () => {
  const db = await setup();
  try {
    const account = (
      await db.query(
        "insert into accounts(name,institution) values ('Synthetic bank','Fixture') returning id",
      )
    ).rows[0].id;
    const cats = (
      await db.query(
        "insert into budget_categories(group_name,line_item_name,category_type) values ('Daily','Food','Expense'),('Daily','Travel','Expense') returning id",
      )
    ).rows.map((r) => r.id);
    const parent = (
      await db.query(
        "insert into transactions(date,description,amount,account_id) values ('2026-09-01','100% synthetic',-120,$1) returning id",
        [account],
      )
    ).rows[0].id;
    await db.query("select stackmint_save_split($1,0,$2::jsonb)", [
      parent,
      JSON.stringify([
        { category_id: cats[0], amount: -70 },
        { category_id: cats[1], amount: -50 },
      ]),
    ]);
    const read = (filters) =>
      db
        .query("select stackmint_transactions($1::jsonb) as result", [
          JSON.stringify(filters),
        ])
        .then((r) => r.rows[0].result);
    const result = await read({
      categoryId: cats[0],
      search: "100%",
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
    });
    assert.equal(result.count, 1);
    assert.equal(result.data[0].amount, -120);
    assert.equal(result.data[0].allocations.length, 2);
    assert.equal(
      (await read({ categoryId: cats[0], status: "uncategorized" })).count,
      0,
    );
    await db.query(
      "select stackmint_edit_transactions($1::jsonb,'{\"archived\":true}'::jsonb)",
      [JSON.stringify([{ id: parent, version: 1 }])],
    );
    assert.equal((await read({})).count, 0);
    assert.equal((await read({ history: "archived" })).data[0].id, parent);
    assert.equal(
      (await read({ id: parent, history: "all" })).data[0].allocations.length,
      2,
    );
    await asUser(db, userB);
    assert.equal((await read({ history: "all" })).count, 0);
  } finally {
    await db.close();
  }
});
test("note versions preserve legacy content and clears, reject stale saves and isolate owners", async () => {
  const db = await setup();
  try {
    const parent = (
      await db.query(
        "insert into transactions(date,amount) values ('2026-09-01',-10) returning id",
      )
    ).rows[0].id;
    await assert.rejects(
      db.query("select stackmint_write_note($1,$2,0,'old','new')", [
        userA,
        parent,
      ]),
      /permission/,
    );
    await db.exec("reset role; set role service_role");
    await db.query(
      "select stackmint_write_note($1,$2,0,'Synthetic legacy note','New note')",
      [userA, parent],
    );
    await assert.rejects(
      db.query("select stackmint_write_note($1,$2,0,'old','Stale note')", [
        userA,
        parent,
      ]),
      /changed/,
    );
    await db.query("select stackmint_write_note($1,$2,1,'New note','')", [
      userA,
      parent,
    ]);
    await asUser(db, userA);
    assert.deepEqual(
      (
        await db.query(
          "select content from transaction_note_versions order by version",
        )
      ).rows.map((r) => r.content),
      ["Synthetic legacy note", "New note", ""],
    );
    await assert.rejects(
      db.query("delete from transaction_note_versions"),
      /permission/,
    );
    await asUser(db, userB);
    assert.equal(
      (await db.query("select * from transaction_note_versions")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
