import test from "node:test";
import assert from "node:assert/strict";
import {
  createTestDatabase,
  asUser,
  userA,
  userB,
} from "./support/database.mjs";

test("disposable schema preserves baseline ownership and documents the refund defect", async () => {
  const db = await createTestDatabase();
  try {
    await db.query("insert into auth.users(id) values ($1),($2)", [
      userA,
      userB,
    ]);
    await asUser(db, userA);
    const category = (
      await db.query(
        "insert into public.budget_categories(group_name,line_item_name,category_type) values ('Everyday','Groceries','Expense') returning id",
      )
    ).rows[0].id;
    await db.query(
      "insert into public.budgets(category_id,year_number,month_number,budget_limit) values ($1,2026,9,200)",
      [category],
    );
    await db.query(
      "insert into public.transactions(date,description,amount,category_id) values ('2026-09-03','Synthetic expense',-100,$1),('2026-09-04','Synthetic refund',25,$1)",
      [category],
    );
    const result = (
      await db.query("select * from public.get_budget_with_rollover(2026,9)")
    ).rows[0];
    // Characterizes v1. Independently calculated v2 expectation: 75.
    assert.equal(Number(result.actual_spent), 125);
    await asUser(db, userB);
    assert.equal(
      (await db.query("select * from public.transactions")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from public.get_budget_with_rollover(2026,9)"))
        .rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});

test("isolated tests reject external fetch without opening a network connection", () => {
  assert.throws(
    () => fetch("https://example.invalid/"),
    /blocked an external fetch/,
  );
});
