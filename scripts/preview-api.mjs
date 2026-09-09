// Loopback-only synthetic API for visual verification. NOT a Supabase emulator for deployment.
// PostgreSQL functions and RLS run in memory; Auth/REST/Storage transport is a bounded test double.
import "./test-network-guard.mjs";
import http from "node:http";
import fs from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { createTestDatabase, userA, userB } from "../tests/support/database.mjs";
const db = await createTestDatabase();
for (const name of (await fs.readdir(new URL("../supabase/proposals/", import.meta.url))).filter(name => name.endsWith(".sql")).sort()) {
  await db.exec(await fs.readFile(new URL("../supabase/proposals/" + name, import.meta.url), "utf8"));
}
await db.query("insert into auth.users(id) values ($1),($2)", [userA, userB]);
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userA]);
const account = (await db.query("insert into accounts(name,institution,type,current_balance,user_id) values ('Everyday checking','Synthetic Bank','Checking',4850,$1) returning id", [userA])).rows[0].id;
const categoryRows = (await db.query("insert into budget_categories(group_name,line_item_name,category_type,user_id) values ('Home','Rent','Expense',$1),('Home','Utilities','Expense',$1),('Everyday','Groceries','Expense',$1),('Everyday','Dining out','Expense',$1),('Everyday','Transport','Expense',$1),('Lifestyle','Travel','Expense',$1),('Lifestyle','Shopping','Expense',$1),('Income','Paycheck','Income',$1),('Transfers','Card payment','Transfer',$1) returning id,line_item_name", [userA])).rows;
const cats = Object.fromEntries(categoryRows.map(row => [row.line_item_name, row.id]));
for (const [name, budget] of Object.entries({ Rent: 1650, Utilities: 180, Groceries: 450, "Dining out": 160, Transport: 120, Travel: 250, Shopping: 100, Paycheck: 5200 })) {
  await db.query("insert into budgets(category_id,year_number,month_number,budget_limit,user_id) values ($1,2026,9,$2,$3)", [cats[name], budget, userA]);
}
const transactions = [
  ["2026-09-01","Synthetic apartment rent",-1650,"Rent"],
  ["2026-09-02","Synthetic utility bill",-92.45,"Utilities"],
  ["2026-09-03","Fixture grocery market",-106.24,"Groceries"],
  ["2026-09-05","Fixture grocery market",-72.50,"Groceries"],
  ["2026-09-06","Fixture grocery refund",18,"Groceries"],
  ["2026-09-04","Synthetic lunch",-48.75,"Dining out"],
  ["2026-09-07","Synthetic dinner",-136.20,"Dining out"],
  ["2026-09-03","Synthetic transit pass",-60,"Transport"],
  ["2026-09-05","Synthetic clothing",-84.99,"Shopping"],
  ["2026-09-01","Synthetic payroll",2600,"Paycheck"],
  ["2026-09-06","Synthetic pending grocery",-32.15,"Groceries","pending"],
  ["2026-09-07","Fixture awaiting category",-41.30,null],
  ["2026-09-02","Synthetic card payment",-400,"Card payment"],
];
for (const [date, description, amount, name, status] of transactions) {
  await db.query("insert into transactions(date,description,amount,category_id,account_id,user_id,external_status,categorization_status,source,manual_override_fields) values ($1,$2,$3,$4,$5,$6,$7,$8,'synthetic', '{}')",
    [date, description, amount, name ? cats[name] : null, account, userA, status ?? "posted", name ? (name === "Shopping" ? "pending" : "final") : "uncategorized"]);
}
await db.query("insert into budgets(category_id,year_number,month_number,budget_limit,user_id) values ($1,2026,8,100,$2)",[cats.Travel,userA]);
const previewConnection=(await db.query("insert into bank_connections(provider,provider_enrollment_id,access_token,institution_name,user_id,status) values ('plaid','synthetic-preview-item','synthetic-preview-token','Synthetic Bank',$1,'active') returning id",[userA])).rows[0].id;
await db.query("insert into provider_change_reviews(user_id,connection_id,entity_type,entity_id,provider_id,proposal_hash,reason,proposed_values,existing_values) select $1,$2,'account',id,'synthetic-preview-account','synthetic-preview-hash','Review a bank balance against a preserved historical balance.','{\"current_balance\":5000}'::jsonb,to_jsonb(a) from accounts a where id=$3",[userA,previewConnection,account]);
await db.query("insert into statement_reconciliation_reviews(user_id,report_id,source_record_id,review_type,statement_account_key,account_id,account_name,transaction_date,proposed_date,amount,description,statement_file,proposed_transaction) values ($1,'synthetic-preview-report','synthetic-source','proposed_import','synthetic-account',$2,'Everyday checking','2026-09-08','2026-09-08',-22.25,'Synthetic statement review','synthetic-statement.pdf','{\"connection_provider\":\"statement\",\"external_transaction_id\":\"synthetic-reviewed-source\"}')",[userA,account]);
await db.query("insert into accounts(name,institution,type,initial_value,initial_date,current_balance,hidden,user_id) values ('Retained historical account','Synthetic Bank','Investment',1200,'2020-01-01',1350,true,$1)",[userA]);
await db.query("insert into plaid_items(access_token,institution_name,user_id) values ('synthetic-token','Earlier synthetic connection',$1)",[userA]);
const sessions = new Map();
const identities = new Map([["preview@stackmint.test",userA],["second@stackmint.test",userB]]);
const user = (id) => ({ id, aud: "authenticated", role: "authenticated", email: id===userA ? "preview@stackmint.test" : "second@stackmint.test", email_confirmed_at:"2026-01-01T00:00:00Z", created_at:"2026-01-01T00:00:00Z", app_metadata:{provider:"email",providers:["email"]}, user_metadata:{}, identities:[] });
function login(id) {
  const access_token = [Buffer.from(JSON.stringify({alg:"HS256",typ:"JWT"})).toString("base64url"),Buffer.from(JSON.stringify({sub:id,aud:"authenticated",role:"authenticated",exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000)})).toString("base64url"),randomBytes(32).toString("base64url")].join(".");
  const refresh_token = randomBytes(32).toString("hex"); sessions.set(access_token,id);sessions.set(refresh_token,id);
  return {access_token,refresh_token,token_type:"bearer",expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:user(id)};
}
let queue=Promise.resolve();
function serialized(fn) { const job=queue.then(fn);queue=job.catch(()=>{});return job; }
const allowedTables=new Set(["accounts","budget_categories","transactions","budgets","bank_connections","transaction_note_versions","statement_reconciliation_reviews","record_revisions"]);
const functionArgs = new Map((await db.query("select proname,proargnames from pg_proc join pg_namespace n on n.oid=pronamespace where n.nspname='public' and proname like 'stackmint_%'")).rows.map(row=>[row.proname,row.proargnames ?? []]));
const identifier=name=>{if(!/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(name))throw new Error("Invalid identifier");return '"' + name + '"';};
const server=http.createServer(async(req,res)=>{
  const send=(status,data,headers={})=>{res.writeHead(status,{"Content-Type":"application/json","Access-Control-Allow-Origin":"http://127.0.0.1:3000","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info, prefer, range, x-supabase-api-version, accept-profile, content-profile, x-retry-count","Access-Control-Allow-Methods":"GET,POST,PUT,HEAD,OPTIONS","Access-Control-Expose-Headers":"Content-Range","Cache-Control":"no-store",...headers});res.end(req.method==="HEAD"?"":JSON.stringify(data));};
  if(req.method==="OPTIONS")return send(204,null);
  const url=new URL(req.url,"http://127.0.0.1:55321");
  if(url.pathname==="/health")return send(200,{disposable:true,storage:"in-memory"});
  try{
    let raw="";for await(const chunk of req){raw+=chunk;if(raw.length>256000)return send(413,{error:"Too large"});}
    const body=raw?JSON.parse(raw):{};
    const token=req.headers.authorization?.replace(/^Bearer /i,"");
    const id=sessions.get(token);
    const service=token==="synthetic-service-key";
    if(url.pathname==="/auth/v1/token"){
      const nextId=url.searchParams.get("grant_type")==="refresh_token"?sessions.get(body.refresh_token):(body.password==="Synthetic-preview-2026!"?identities.get(body.email):null);
      if(!nextId)return send(400,{code:"invalid_credentials",msg:"Invalid synthetic credentials"});
      return send(200,login(nextId));
    }
    if(url.pathname==="/auth/v1/user")return id?send(200,user(id)):send(401,{code:"bad_jwt",msg:"Synthetic session required"});
    if(url.pathname==="/auth/v1/logout"){sessions.delete(token);return send(200,{});}
    if(!id&&!service)return send(401,{message:"Synthetic session required"});
    if(url.pathname.startsWith("/storage/v1/"))return send(404,{statusCode:"404",error:"not_found",message:"Object not found"});
    await serialized(async()=>{
      await db.exec("begin");
      try{
        await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id??""]);
        await db.exec(service?"set local role service_role":"set local role authenticated");
        let result;
        if(url.pathname.startsWith("/rest/v1/rpc/")){
          const name=url.pathname.split("/").at(-1);
          if(!functionArgs.has(name))throw new Error("Unknown synthetic RPC");
          const supplied=Object.entries(body).filter(([name])=>functionArgs.get(url.pathname.split("/").at(-1)).includes(name));
          const params=supplied.map(([,value])=>typeof value==="object"&&value!==null?JSON.stringify(value):value);
          const args=supplied.map(([name],index)=>identifier(name)+" => $"+(index+1)).join(",");
          result=(await db.query("select public."+identifier(name)+"("+args+") as data",params)).rows[0].data;
        }else{
          const table=url.pathname.split("/").at(-1);
          if(!allowedTables.has(table)||!["GET","HEAD"].includes(req.method))throw new Error("Unsupported synthetic REST operation");
          const params=[],where=[];
          for(const[key,value]of url.searchParams){
            if(["select","order","limit","offset"].includes(key))continue;
            if(key==="or"){
              if(value==="(external_status.is.null,external_status.neq.removed)")where.push("(external_status is null or external_status<>'removed')");
              else throw new Error("Unsupported synthetic OR filter");
              continue;
            }
            const dot=value.indexOf("."),op=value.slice(0,dot),val=value.slice(dot+1);
            const column=identifier(key);
            if(op==="eq"){params.push(val);where.push(column+"=$"+params.length);}
            else if(op==="is"&&val==="null")where.push(column+" is null");
            else if(op==="in"){const vals=val.slice(1,-1).split(",");params.push(vals);where.push(column+"::text=any($"+params.length+"::text[])");}
            else throw new Error("Unsupported synthetic filter");
          }
          const predicate=where.length?" where "+where.join(" and "):"";
          const count=Number((await db.query("select count(*) as count from public."+identifier(table)+predicate,params)).rows[0].count);
          const selected=url.searchParams.get("select")??"*";
          const columns=selected==="*"?"*":selected.split(",").map(x=>identifier(x.trim())).join(",");
          const order=url.searchParams.get("order")?.split(",").map(part=>{const[col,direction]=part.split(".");return identifier(col)+(direction==="desc"?" desc":" asc");}).join(",");
          const limit=Math.min(1000,Math.max(0,Number(url.searchParams.get("limit")??1000)));
          const offset=Math.max(0,Number(url.searchParams.get("offset")??0));
          const rows=(await db.query("select "+columns+" from public."+identifier(table)+predicate+(order?" order by "+order:"")+" limit "+limit+" offset "+offset,params)).rows;
          const single=req.headers.accept?.includes("vnd.pgrst.object");
          result=single?(rows[0]??null):rows;
          res.setHeader("Content-Range",rows.length?offset+"-"+(offset+rows.length-1)+"/"+count:"*/"+count);
        }
        await db.exec("commit");
        send(200,result);
      }catch(error){await db.exec("rollback");send(error.code==="40001"?409:400,{code:error.code??"TEST_DOUBLE",message:error.message});}
    });
  }catch{send(500,{error:"Synthetic request failed"});}
});
server.listen(55321,"127.0.0.1",()=>console.log("Disposable StackMint API ready at http://127.0.0.1:55321. All records are synthetic."));
process.on("SIGTERM",()=>server.close(()=>db.close()));
