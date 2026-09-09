import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createTestDatabase, asUser, userA, userB } from "./support/database.mjs";
async function setup() {
  const db=await createTestDatabase();
  await db.query("insert into auth.users(id) values ($1),($2)",[userA,userB]);
  for(const name of ["01-preservation","02-finance"])await db.exec(await fs.readFile(new URL("../supabase/proposals/"+name+".sql",import.meta.url),"utf8"));
  await asUser(db,userA);
  const account=(await db.query("insert into accounts(name,institution,type,hidden) values ('Synthetic retired account','Fixture','Retired type',true) returning id")).rows[0].id;
  const categories=(await db.query("insert into budget_categories(group_name,line_item_name,category_type) values ('Everyday','Groceries','Expense'),('Income','Pay','Income'),('Movements','Transfer','Transfer'),('Everyday','Transport','Expense') returning id")).rows.map(r=>r.id);
  const add=(date,amount,category=categories[0],status="posted",parent=null,isSplit=false)=>db.query("insert into transactions(date,description,amount,category_id,account_id,external_status,parent_id,is_split,categorization_status) values ($1,'Synthetic fixture',$2,$3,$4,$5,$6,$7,'final') returning id",[date,amount,category,account,status,parent,isSplit]).then(r=>r.rows[0].id);
  const budget=(year,month)=>db.query("select stackmint_budget($1,$2) as result",[year,month]).then(r=>r.rows[0].result);
  return {db,account,categories,add,budget};
}
test("refunds, income reversals, transfers, and bank pending follow independent expectations across all reports",async()=>{
  const {db,categories:c,add,budget}=await setup();
  try {
    await db.query("select stackmint_save_budgets($1::jsonb)",[JSON.stringify([{category_id:c[0],year:2026,month:9,budget_limit:200,expected_version:null}])]);
    await add("2026-09-03",-100); await add("2026-09-04",25);
    await add("2026-09-04",-20,c[0],"pending");
    await add("2026-09-05",1000,c[1]); await add("2026-09-06",-50,c[1]);
    await add("2026-09-07",-300,c[2]); await add("2026-09-07",300,c[2]);
    await add("2026-09-08",-40,null); await add("2026-09-08",10,null);
    await add("2026-09-09",-999,c[0],"removed");
    const b=await budget(2026,9),expense=b.items.find(r=>r.category_id===c[0]),income=b.items.find(r=>r.category_id===c[1]);
    assert.equal(expense.actual_spent,75);assert.equal(expense.effective_budget-expense.actual_spent,125);
    assert.equal(expense.pending_spent,20);assert.equal(income.actual_spent,950);
    assert.equal(b.attention.uncategorized_outflow,40);assert.equal(b.attention.uncategorized_inflow,10);
    assert.ok(!b.items.some(r=>r.category_id===c[2]));
    const detail=(await db.query("select stackmint_budget_activity(2026,9,$1) as result",[c[0]])).rows[0].result;
    assert.equal(detail.total,75);assert.equal(detail.rows.length,2);
    const analysis=(await db.query("select stackmint_analysis('2026-09-01','2026-10-01') as result")).rows[0].result;
    assert.equal(analysis.groups[0].total,75);
    assert.equal(analysis.flow[0].income,950);assert.equal(analysis.flow[0].expenses,75);assert.equal(analysis.flow[0].net,875);
    await asUser(db,userB);
    assert.equal((await budget(2026,9)).items.length,0);
    assert.equal((await db.query("select stackmint_budget_activity(2026,9,$1) as result",[c[0]])).rows[0].result.count,0);
  }finally{await db.close();}
});
test("carry crosses years, includes zero-allocation gaps, and never creates a plan while reading",async()=>{
  const {db,categories:c,add,budget}=await setup();
  try {
    await db.query("select stackmint_save_budgets($1::jsonb)",[JSON.stringify([
      {category_id:c[0],year:2025,month:12,budget_limit:100,expected_version:null},
      {category_id:c[0],year:2026,month:1,budget_limit:150,expected_version:null},
      {category_id:c[0],year:2026,month:3,budget_limit:100,expected_version:null}
    ])]);
    await add("2025-11-01",-999); // Before this category's first plan: no invented carry.
    await add("2025-12-01",-80); await add("2026-01-01",-180); await add("2026-02-01",-30);
    assert.equal((await budget(2026,1)).items.find(r=>r.category_id===c[0]).rollover,20);
    const before=(await db.query("select jsonb_agg(to_jsonb(b) order by id) as value from budgets b")).rows[0].value;
    await db.exec("begin read only");
    const feb=(await budget(2026,2)).items.find(r=>r.category_id===c[0]);
    const mar=(await budget(2026,3)).items.find(r=>r.category_id===c[0]);
    await db.exec("commit");
    assert.equal(feb.has_budget,false);assert.equal(feb.rollover,-10);assert.equal(feb.actual_spent,30);
    assert.equal(mar.rollover,-40);assert.equal(mar.effective_budget-mar.actual_spent,60);
    assert.deepEqual((await db.query("select jsonb_agg(to_jsonb(b) order by id) as value from budgets b")).rows[0].value,before);
  }finally{await db.close();}
});
test("split category contributions agree with drilldowns and exclude retained inactive children",async()=>{
  const {db,categories:c,add,budget}=await setup();
  try {
    const parent=await add("2026-09-01",-120,null);
    await db.query("select stackmint_save_split($1,0,$2::jsonb)",[parent,JSON.stringify([{category_id:c[0],amount:-70},{category_id:c[3],amount:-50}])]);
    const b=await budget(2026,9);
    assert.equal(b.items.find(r=>r.category_id===c[0]).actual_spent,70);
    const drawer=(await db.query("select stackmint_budget_activity(2026,9,$1) as result",[c[0]])).rows[0].result;
    assert.equal(drawer.total,70);assert.equal(drawer.rows[0].parent_amount,-120);assert.equal(drawer.rows[0].contribution,70);
    const accountFlow=(await db.query("select stackmint_analysis('2026-09-01','2026-10-01') as result")).rows[0].result.movements[0];
    assert.equal(accountFlow.expenses,120);
    await db.query("select stackmint_unsplit($1,1)",[parent]);
    assert.equal((await budget(2026,9)).items.find(r=>r.category_id===c[0]).actual_spent,0);
    assert.equal((await db.query("select count(*)::int as n from transactions where parent_id=$1",[parent])).rows[0].n,2);
  }finally{await db.close();}
});
test("date boundaries and pagination remain exact beyond API row caps",async()=>{
  const {db,account,categories:c,budget,add}=await setup();
  try {
    await db.query("insert into transactions(date,description,amount,category_id,account_id,external_status) select '2026-09-15','Synthetic generated',-0.01,$1,$2,'posted' from generate_series(1,5101)",[c[0],account]);
    await add("2026-08-31",-999);await add("2026-10-01",-999);await add("2028-02-29",-12);
    assert.equal((await budget(2026,9)).items.find(r=>r.category_id===c[0]).actual_spent,51.01);
    const page=(await db.query("select stackmint_budget_activity(2026,9,$1,'booked',5100,100) as result",[c[0]])).rows[0].result;
    assert.equal(page.count,5101);assert.equal(page.rows.length,1);assert.equal(page.total,51.01);
    assert.equal((await budget(2028,2)).items.find(r=>r.category_id===c[0]).actual_spent,12);
    assert.equal((await budget(2028,3)).items.find(r=>r.category_id===c[0]).actual_spent,0);
  }finally{await db.close();}
});
