import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {createTestDatabase,asUser,userA,userB} from "./support/database.mjs";
test("all proposals apply additively and owned history keeps split allocations, note versions and legacy connection metadata accessible",async()=>{
 const db=await createTestDatabase();try{
  await db.query("insert into auth.users(id) values ($1),($2)",[userA,userB]);
  const account=(await db.query("insert into accounts(name,institution,type,user_id) values ('Retained fixture','Synthetic','Checking',$1) returning id",[userA])).rows[0].id;
  const txn=(await db.query("insert into transactions(date,description,amount,account_id,user_id) values ('2026-09-01','Retained parent',-30,$1,$2) returning *",[account,userA])).rows[0];
  await db.query("insert into plaid_items(access_token,institution_name,user_id) values ('synthetic-token','Earlier synthetic institution',$1)",[userA]);
  await db.query("insert into bank_connections(provider,provider_enrollment_id,access_token,institution_name,user_id,status) values ('teller','synthetic-old-item','synthetic-token','Earlier bank',$1,'inactive')",[userA]);
  for(const name of (await fs.readdir(new URL("../supabase/proposals/",import.meta.url))).filter(name=>name.endsWith(".sql")).sort())await db.exec(await fs.readFile(new URL("../supabase/proposals/"+name,import.meta.url),"utf8"));
  const after=(await db.query("select * from transactions where id=$1",[txn.id])).rows[0];
  for(const[key,value]of Object.entries(txn))assert.deepEqual(after[key],value,key);
  assert.equal((await db.query("select count(*)::int n from record_revisions")).rows[0].n,0);
  const category=(await db.query("insert into budget_categories(group_name,line_item_name,category_type,user_id) values ('Fixture','Food','Expense',$1) returning id",[userA])).rows[0].id;
  await asUser(db,userA);
  await db.query("select stackmint_save_split($1,0,$2::jsonb)",[txn.id,JSON.stringify([{amount:-10,category_id:category},{amount:-20,category_id:category}])]);
  const version=(await db.query("select row_version from transactions where id=$1",[txn.id])).rows[0].row_version;
  await db.query("select stackmint_unsplit($1,$2)",[txn.id,version]);
  const history=(await db.query("select stackmint_transaction_history($1) result",[txn.id])).rows[0].result;
  assert.ok(history.rows.some(row=>!row.original_transaction&&row.new_values.archived_at));
  await db.exec("reset role;set role service_role");
  await db.query("select stackmint_write_note($1,$2,0,'Legacy synthetic note','New synthetic note')",[userA,txn.id]);
  await asUser(db,userA);
  assert.deepEqual((await db.query("select stackmint_transaction_history($1,'notes') result",[txn.id])).rows[0].result.rows.map(row=>row.content),["New synthetic note","Legacy synthetic note"]);
  const connections=(await db.query("select stackmint_legacy_connections() result")).rows[0].result;
  assert.equal((await db.query("select stackmint_categorization_counts() result")).rows[0].result.eligible,1);
  assert.equal(connections.bank.length,1);assert.equal(connections.legacy.length,1);
  assert.ok(!JSON.stringify(connections).includes("synthetic-token"));
  await assert.rejects(db.query("select access_token from plaid_items"),/permission/);
  await asUser(db,userB);await assert.rejects(db.query("select stackmint_transaction_history($1)",[txn.id]),/unavailable/);
  assert.deepEqual((await db.query("select stackmint_legacy_connections() result")).rows[0].result,{bank:[],legacy:[]});
 }finally{await db.close();}
});
