import fs from "node:fs";
import path from "node:path";

// A plan is an operator attestation, not automatic user approval. Never manufacture one.
export function requireExistingDataOperation(operation, {write=false,argv=process.argv.slice(2)}={}) {
 if(process.env.STACKMINT_ISOLATED==="true")throw new Error("Existing-data operator commands are disabled in isolated verification.");
 if(!write) {
  if(!argv.includes("--allow-existing-data-read"))throw new Error("This command can read real financial data. Explicit --allow-existing-data-read is required; it is not a test command.");
  return;
 }
 const planPath=argv.find(arg=>arg.startsWith("--approved-change-plan="))?.split("=").slice(1).join("=");
 if(!planPath)throw new Error("Existing-data writes require --approved-change-plan=<reviewed JSON file>, separate user authorization and verified recovery. See docs/stackmint-v2-operations.md.");
 const plan=JSON.parse(fs.readFileSync(path.resolve(planPath),"utf8"));
 for(const key of ["authorizationReference","recoveryReference","restoreVerificationReference","targetUrl","userId","scope"]) {
  if(typeof plan[key]!=="string" || !plan[key].trim())throw new Error("The change plan lacks authorization, scope or verified recovery evidence.");
 }
 if(plan.operation!==operation)throw new Error("Change plan operation does not match this command.");
 return plan;
}
export function assertOperationTarget(plan,url,userId) {
 if(plan && (plan.targetUrl!==url || (userId && plan.userId!==userId)))throw new Error("The configured target does not match the approved change plan.");
}
