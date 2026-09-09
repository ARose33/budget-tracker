import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  createTestDatabase,
  asUser,
  userA,
  userB,
} from "./support/database.mjs";
import {
  requireExistingDataOperation,
  assertOperationTarget,
} from "../scripts/lib/operator-safety.mjs";
test("operator preflight fails closed without reading environment credentials", () => {
  assert.throws(
    () => requireExistingDataOperation("apply", { write: true, argv: [] }),
    /disabled|change-plan/,
  );
  assert.throws(
    () => requireExistingDataOperation("read", { argv: [] }),
    /disabled|allow-existing/,
  );
  assert.throws(
    () =>
      assertOperationTarget(
        { targetUrl: "http://127.0.0.1:1", userId: userA },
        "http://127.0.0.1:2",
        userA,
      ),
    /match/,
  );
});
test("statement batch receipts are atomic and retry-safe; archives refuse later edits and retain rows", async () => {
  const db = await createTestDatabase();
  try {
    await db.query("insert into auth.users(id) values ($1),($2)", [
      userA,
      userB,
    ]);
    for (const name of [
      "01-preservation",
      "05-note-history",
      "10-statement-batches",
    ])
      await db.exec(
        await fs.readFile(
          new URL("../supabase/proposals/" + name + ".sql", import.meta.url),
          "utf8",
        ),
      );
    const account = (
      await db.query(
        "insert into accounts(name,institution,type,user_id) values ('Synthetic','Fixture','Checking',$1) returning id",
        [userA],
      )
    ).rows[0].id;
    const row = {
      user_id: userA,
      account_id: account,
      date: "2026-09-01",
      amount: -12.34,
      description: "Synthetic approved record",
      source: "retained",
      upload_source: "original.pdf",
      external_transaction_id: "synthetic-import",
    };
    await db.exec("set role service_role");
    const apply = async (id, rows) =>
      (
        await db.query(
          "select stackmint_import_statement_batch($1,$2,'synthetic-report',$3::jsonb) result",
          [userA, id, JSON.stringify(rows)],
        )
      ).rows[0].result;
    await assert.rejects(
      apply("bad-batch", [
        row,
        { ...row, external_transaction_id: "bad", date: null },
      ]),
    );
    assert.equal(
      (await db.query("select count(*)::int n from transactions")).rows[0].n,
      0,
    );
    for (const amount of [
      "NaN",
      "Infinity",
      "-Infinity",
      "12.345",
      null,
      "10000000000000",
    ]) {
      await assert.rejects(
        apply("invalid-amount", [
          row,
          { ...row, external_transaction_id: "invalid-cent", amount },
        ]),
        /finite and exact/,
      );
      assert.equal(
        (await db.query("select count(*)::int n from transactions")).rows[0].n,
        0,
      );
    }
    const receipt = await apply("batch", [row]);
    assert.deepEqual(await apply("batch", [row]), receipt);
    const id = receipt.insertedTransactionIds[0];
    await asUser(db, userA);
    await db.query(
      'select stackmint_edit_transactions($1::jsonb,\'{"description":"My later edit"}\')',
      [JSON.stringify([{ id, version: 0 }])],
    );
    await db.exec("reset role;set role service_role");
    await assert.rejects(
      db.query("select stackmint_archive_statement_batch($1,'batch')", [userA]),
      /changed/,
    );
    const clean = await apply("clean-batch", [
      { ...row, external_transaction_id: "clean-source" },
    ]);
    assert.equal(
      (
        await db.query(
          "select stackmint_archive_statement_batch($1,'clean-batch') n",
          [userA],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select stackmint_archive_statement_batch($1,'clean-batch') n",
          [userA],
        )
      ).rows[0].n,
      0,
    );
    const retained = (
      await db.query(
        "select id,source,upload_source,archived_at from transactions where id=$1",
        [clean.insertedTransactionIds[0]],
      )
    ).rows[0];
    assert.ok(retained.archived_at);
    assert.equal(retained.source, "retained");
    assert.equal(retained.upload_source, "original.pdf");
    await asUser(db, userA);
    await assert.rejects(apply("forbidden", [row]), /permission/);
    await asUser(db, userB);
    assert.equal(
      (await db.query("select * from statement_batch_receipts")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
