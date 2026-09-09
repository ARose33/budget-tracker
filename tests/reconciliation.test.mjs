import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {createTestDatabase,asUser,userA,userB} from "./support/database.mjs";
async function setup(){
 const db=await createTestDatabase();await db.query("insert into auth.users(id) values ($1),($2)",[userA,userB]);
 for(const name of ["01-preservation","09-reconciliation"])await db.exec(await fs.readFile(new URL("../supabase/proposals/"+name+".sql",import.meta.url),"utf8"));
 const account=(await db.query("insert into accounts(name,institution,type,user_id) values ('Fixture checking','Synthetic','Checking',$1) returning id",[userA])).rows[0].id;
 const add=async(key,extra={})=>{
  const payload={connection_provider:"statement",external_transaction_id:key,source:"Original source",...extra};
  return (await db.query("insert into statement_reconciliation_reviews(user_id,report_id,source_record_id,review_type,statement_account_key,account_id,account_name,transaction_date,proposed_date,amount,description,statement_file,proposed_transaction) values ($1,'synthetic-report',$2,'proposed_import','synthetic-account',$3,'Fixture checking','2026-08-02','2026-08-02',-12.34,'Synthetic statement row','synthetic.pdf',$4::jsonb) returning *",[userA,key,account,JSON.stringify(payload)])).rows[0];
 };
 const resolve=async(row,decision,id=null,version=null)=>(await db.query("select stackmint_resolve_reconciliation($1,$2,$3,$4,$5,'Synthetic review note') as result",[row.id,row.row_version,decision,id,version])).rows[0].result;
 return {db,account,add,resolve};
}
test("statement decisions preserve identity and source history, are retry-safe and reject conflicting imports",async()=>{
 const {db,add,resolve}=await setup();try{
  const row=await add("synthetic-source-1"),same=await add("synthetic-source-2",{external_transaction_id:"synthetic-source-1"}),missing=await add("missing",{external_transaction_id:null});
  await asUser(db,userA);
  const first=await resolve(row,"imported");assert.deepEqual(await resolve(row,"imported"),first);
  await assert.rejects(resolve(row,"ignored"),/different decision/);
  await assert.rejects(resolve(same,"imported"),/already exists/);
  await assert.rejects(resolve(missing,"imported"),/lacks an import identity/);
  assert.equal((await db.query("select count(*)::int n from transactions")).rows[0].n,1);
  assert.equal((await db.query("select source from transactions")).rows[0].source,"Original source");
  const history=(await db.query("select stackmint_reconciliation('{\"status\":\"imported\"}') as result")).rows[0].result;
  assert.equal(history.items[0].imported_transaction_id,first.transactionId);
  assert.equal(history.items[0].proposed_transaction.external_transaction_id,"synthetic-source-1");
  await asUser(db,userB);await assert.rejects(resolve(row,"imported"),/unavailable/);
  assert.equal((await db.query("select stackmint_reconciliation() as result")).rows[0].result.summary.totalQueue,0);
  await db.exec("reset role");
  await assert.rejects(db.query("update statement_reconciliation_reviews set description='Overwritten' where id=$1",[row.id]),/immutable/);
  await assert.rejects(db.query("update statement_reconciliation_reviews set status='pending' where id=$1",[row.id]),/preserved/);
 }finally{await db.close();}
});
test("matching checks observed candidate versions and never modifies the matched ledger record",async()=>{
 const {db,account,add,resolve}=await setup();try{
  const row=await add("candidate-review");
  const txn=(await db.query("insert into transactions(date,description,amount,account_id,user_id) values ('2026-08-02','Existing manual entry',-12.34,$1,$2) returning *",[account,userA])).rows[0];
  // Candidate membership is part of the immutable insert. This fixture is created anew.
  const replacement=(await db.query("insert into statement_reconciliation_reviews select gen_random_uuid(),user_id,report_id,'candidate-complete',review_type,status,statement_account_key,account_id,account_name,transaction_date,posted_date,proposed_date,amount,description,statement_file,statement_period_start,statement_period_end,page,row_reference,array[$2::uuid],candidates,reason,proposed_transaction,risk_flags,decision_note,matched_transaction_id,imported_transaction_id,reviewed_at,reviewed_by,created_at,updated_at,0 from statement_reconciliation_reviews where id=$1 returning *",[row.id,txn.id])).rows[0];
  await asUser(db,userA);
  await assert.rejects(resolve(replacement,"matched",txn.id,99),/Candidate changed/);
  const before=(await db.query("select to_jsonb(t) v from transactions t")).rows[0].v;
  await resolve(replacement,"matched",txn.id,0);
  assert.deepEqual((await db.query("select to_jsonb(t) v from transactions t")).rows[0].v,before);
  await assert.rejects(db.query("select resolve_statement_reconciliation_review($1,'ignored')",[row.id]),/permission/);
 }finally{await db.close();}
});
test("reconciliation counts and exact net amounts include all rows beyond REST caps",async()=>{
 const {db,account}=await setup();try{
  await db.query("insert into statement_reconciliation_reviews(user_id,report_id,source_record_id,review_type,statement_account_key,account_id,account_name,transaction_date,proposed_date,amount,description,statement_file,proposed_transaction) select $1,'report',g::text,'proposed_import','fixture',$2,'Fixture checking','2026-01-01','2026-01-01',-0.01,'Synthetic cap fixture','synthetic.pdf','{}' from generate_series(1,5001) g",[userA,account]);
  await asUser(db,userA);const result=(await db.query("select stackmint_reconciliation('{\"page\":5001}') as result")).rows[0].result;
  assert.equal(result.summary.total,5001);assert.equal(result.summary.amount,-50.01);assert.equal(result.count,5001);assert.equal(result.items.length,1);
 }finally{await db.close();}
});
