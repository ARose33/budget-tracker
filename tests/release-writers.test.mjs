import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createTestDatabase, asUser, userA } from "./support/database.mjs";

test("old HTTP writers and legacy note overwrites are rejected without blocking v2 or unrelated files", async () => {
  const db = await createTestDatabase();
  try {
    await db.query("insert into auth.users(id) values ($1)", [userA]);
    const account = (await db.query("insert into accounts(name,institution,type,user_id) values ('Fixture','Synthetic','Checking',$1) returning id", [userA])).rows[0].id;
    await db.exec("create schema storage; create table storage.objects(id integer primary key,bucket_id text,name text); insert into storage.objects values (1,'transaction-notes','retained.txt'),(2,'unrelated','keep.txt');");
    for (const file of ["01-preservation.sql", "12-release-writers.sql"])
      await db.exec(await fs.readFile(new URL("../supabase/proposals/" + file, import.meta.url), "utf8"));
    await asUser(db, userA);
    await db.exec("select set_config('request.method','PATCH',false); select set_config('request.headers','{}',false);");
    await assert.rejects(db.query("update accounts set name='Stale edit' where id=$1", [account]), /Reload the app/);
    assert.equal((await db.query("select name from accounts where id=$1", [account])).rows[0].name, "Fixture");
    await db.exec(`select set_config('request.headers','{"x-stackmint-version":"2"}',false);`);
    await db.query("update accounts set name='Current edit' where id=$1", [account]);
    assert.equal((await db.query("select name from accounts where id=$1", [account])).rows[0].name, "Current edit");
    await db.exec("reset role");
    await assert.rejects(db.exec("update storage.objects set name='overwrite.txt' where id=1"), /versioned note/);
    await assert.rejects(db.exec("delete from storage.objects where id=1"), /versioned note/);
    await db.exec("update storage.objects set name='allowed.txt' where id=2");
    assert.equal((await db.query("select name from storage.objects where id=1")).rows[0].name, "retained.txt");
  } finally { await db.close(); }
});
