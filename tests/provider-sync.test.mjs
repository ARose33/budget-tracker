import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createTestDatabase, asUser, userA } from "./support/database.mjs";

test("explicit provider review applies once, rejects stale edits and leaves kept records intact",async()=>{
 const {db,connection,acquire,apply,release}=await setup();
 try{
  const account=(await db.query("insert into accounts(name,institution,type,connection_provider,external_account_id,user_id,current_balance) values ('My name','Fixture','Checking','plaid','synthetic-account',$1,100) returning id",[userA])).rows[0].id;
  const id=(await db.query("insert into transactions(date,description,amount,account_id,user_id,connection_provider,external_transaction_id) values ('2026-09-01','Historical description',-20,$1,$2,'plaid','synthetic-tx') returning id",[account,userA])).rows[0].id;
  await apply(await acquire(token1),[incoming({amount:-25})]);await release(token1);
  await asUser(db,userA);
  const list=(await db.query("select stackmint_provider_reviews() as result")).rows[0].result;
  assert.equal(list.count,2);
  const review=list.rows.find(row=>row.entity_type==="transaction");
  assert.equal(review.current.id,id);
  await assert.rejects(db.query("select stackmint_resolve_provider_review($1,'accept',-1)",[review.id]),/changed/);
  await db.query("select stackmint_resolve_provider_review($1,'accept',$2)",[review.id,review.current.row_version]);
  await db.query("select stackmint_resolve_provider_review($1,'accept',$2)",[review.id,review.current.row_version]);
  const row=(await db.query("select id,amount from transactions")).rows[0];
  assert.equal(row.id,id);assert.equal(Number(row.amount),-25);
  const balanceReview=list.rows.find(row=>row.entity_type==="account");
  await db.query("select stackmint_resolve_provider_review($1,'keep')",[balanceReview.id]);
  assert.equal(Number((await db.query("select current_balance from accounts")).rows[0].current_balance),100);
  await assert.rejects(db.query("update provider_change_reviews set proposed_values='{}'"),/permission/);
  await db.exec("reset role; set role service_role");
  const before=(await db.query("select to_jsonb(t) as value from transactions t")).rows;
  await db.query("select stackmint_begin_disconnect($1,$2)",[connection,userA]);
  await assert.rejects(acquire(token2),/not available/);
  assert.deepEqual((await db.query("select to_jsonb(t) as value from transactions t")).rows,before);
 }finally{await db.close();}
});
async function setup() {
 const db=await createTestDatabase();
 await db.query("insert into auth.users(id) values ($1)",[userA]);
 for(const name of ["01-preservation","02-finance","06-provider-sync","07-provider-review"]) await db.exec(await fs.readFile(new URL("../supabase/proposals/"+name+".sql",import.meta.url),"utf8"));
 const connection=(await db.query("insert into bank_connections(provider,provider_enrollment_id,access_token,user_id) values ('plaid','synthetic-item','synthetic-token',$1) returning id",[userA])).rows[0].id;
 await db.exec("set role service_role");
 const acquire=async(token)=> (await db.query("select stackmint_acquire_sync($1,$2) as result",[connection,token])).rows[0].result;
 const apply=async(lease,transactions,removed=[],accounts=[{provider_id:"synthetic-account",name:"Synthetic account",institution:"Fixture bank",type:"Checking",balance:500}],next="next")=>(await db.query("select stackmint_apply_sync($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) as result",[connection,lease.token,lease.generation,lease.cursor,next,JSON.stringify(accounts),JSON.stringify(transactions),JSON.stringify(removed)])).rows[0].result;
 const release=(token)=>db.query("select stackmint_release_sync($1,$2)",[connection,token]);
 return {db,connection,acquire,apply,release};
}
const incoming=(extra={})=>({provider_id:"synthetic-tx",pending_id:null,account_provider_id:"synthetic-account",date:"2026-09-01",description:"Synthetic merchant",amount:-20,pending:false,...extra});
const token1="30000000-0000-4000-8000-000000000001",token2="30000000-0000-4000-8000-000000000002";
test("provider cycles are atomic, receipt-idempotent and fenced against overlapping or stale workers",async()=>{
 const {db,connection,acquire,apply,release}=await setup();
 try{
  const lease=await acquire(token1);
  await assert.rejects(acquire(token2),/already syncing/);
  await assert.rejects(apply(lease,[incoming(),incoming({provider_id:"bad",date:null})]),/Invalid provider/);
  assert.equal((await db.query("select count(*)::int as n from transactions")).rows[0].n,0);
  assert.equal((await db.query("select sync_cursor from bank_connections where id=$1",[connection])).rows[0].sync_cursor,null);
  const result=await apply(lease,[incoming()]);
  assert.equal(result.transactions,1);
  const rows=(await db.query("select id,row_version from transactions")).rows;
  assert.deepEqual(await apply(lease,[incoming()]),result);
  assert.deepEqual((await db.query("select id,row_version from transactions")).rows,rows);
  await release(token1);
  const nextLease=await acquire(token2);
  await assert.rejects(apply(lease,[incoming({amount:-999})]),/lease/);
  assert.equal((await apply(nextLease,[incoming()])).transactions,0);
  await asUser(db,userA);await assert.rejects(acquire(token1),/permission/);
 }finally{await db.close();}
});
test("pending-to-posted preserves identity and manual edits; replay cannot recreate pending rows",async()=>{
 const {db,acquire,apply,release}=await setup();
 try {
  const lease=await acquire(token1);
  await apply(lease,[incoming({provider_id:"pending-id",pending:true})]);
  const first=(await db.query("select * from transactions")).rows[0];
  await asUser(db,userA);
  await db.query("select stackmint_edit_transactions($1::jsonb,'{\"description\":\"My edited description\"}'::jsonb)",[JSON.stringify([{id:first.id,version:0}])]);
  await db.exec("reset role; set role service_role");await release(token1);
  const nextLease=await acquire(token2);
  await apply(nextLease,[incoming({provider_id:"pending-id",pending:true}),incoming({provider_id:"posted-id",pending_id:"pending-id",amount:-22,description:"Provider renamed merchant"})],["pending-id"]);
  const rows=(await db.query("select * from transactions where parent_id is null")).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].id,first.id);assert.equal(rows[0].external_transaction_id,"posted-id");
  assert.equal(rows[0].description,"My edited description");assert.equal(Number(rows[0].amount),-22);assert.equal(rows[0].external_status,"posted");
  assert.equal((await db.query("select count(*)::int as n from provider_change_reviews")).rows[0].n,1);
  await release(token2);const third=await acquire(token1);
  await apply(third,[incoming({provider_id:"pending-id",pending:true}),incoming({provider_id:"posted-id",pending_id:"pending-id",amount:-22,description:"Provider renamed merchant"})]);
  assert.equal((await db.query("select count(*)::int as n from transactions")).rows[0].n,1);
 }finally{await db.close();}
});
test("historical field authority and possible duplicates are preserved for explicit review",async()=>{
 const {db,acquire,apply}=await setup();
 try{
  const account=(await db.query("insert into accounts(name,institution,type,connection_provider,external_account_id,user_id,current_balance) values ('My name','My institution','Checking','plaid','synthetic-account',$1,100) returning id",[userA])).rows[0].id;
  const legacy=(await db.query("insert into transactions(date,description,amount,account_id,user_id,connection_provider,external_transaction_id,source,upload_source) values ('2026-09-01','Historical edit',-20,$1,$2,'plaid','synthetic-tx','old-source','old-upload') returning id",[account,userA])).rows[0].id;
  await db.query("insert into transactions(date,description,amount,account_id,user_id,not_duplicate) values ('2026-09-02','Historical possible match',-15,$1,$2,false),('2026-09-02','Verified distinct',-17,$1,$2,true)",[account,userA]);
  const lease=await acquire(token1);
  const result=await apply(lease,[incoming({amount:-25}),incoming({provider_id:"possible-new",date:"2026-09-02",amount:-15}),incoming({provider_id:"verified-new",date:"2026-09-02",amount:-17})]);
  const row=(await db.query("select * from transactions where id=$1",[legacy])).rows[0];
  assert.equal(Number(row.amount),-20);assert.equal(row.description,"Historical edit");assert.equal(row.source,"old-source");assert.equal(row.upload_source,"old-upload");
  const savedAccount=(await db.query("select * from accounts where id=$1",[account])).rows[0];
  assert.equal(savedAccount.name,"My name");assert.equal(Number(savedAccount.current_balance),100);
  assert.equal(result.reviews,3);
  assert.equal((await db.query("select count(*)::int as n from transactions")).rows[0].n,4);
  assert.equal((await db.query("select count(*)::int as n from transactions where external_transaction_id='possible-new'")).rows[0].n,0);
 }finally{await db.close();}
});
