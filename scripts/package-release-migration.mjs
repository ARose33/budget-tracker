import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const migrationDirectory = path.join(root, "supabase/migrations");
const files = fs.readdirSync(migrationDirectory).filter((name) => name.endsWith("_stackmint_v2_release.sql"));
if (files.length !== 1) throw new Error("Generate exactly one release migration with the Supabase CLI first");
const before = `-- Approved StackMint v2 release. Keep all original rows and field values.
-- The runner executes this file and its history entry in one transaction.
create temporary table stackmint_release_before (
  schema_name text, table_name text, original_columns text, fingerprint jsonb
) on commit drop;
create or replace function pg_temp.stackmint_release_fingerprint(s text,t text,c text)
returns jsonb language plpgsql as $fingerprint$
declare result jsonb;
begin
  execute format('select jsonb_build_object(''rows'',count(*),''sha256'',encode(sha256(convert_to(coalesce(string_agg(h,'''' order by h),''''),''UTF8'')),''hex'')) from (select encode(sha256(convert_to(to_jsonb(r)::text,''UTF8'')),''hex'') h from (select %s from %I.%I) r) hashes',c,s,t) into result;
  return result;
end;
$fingerprint$;
do $baseline$
declare t record; columns_sql text;
begin
  for t in select n.nspname,c.relname,c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and (n.nspname in ('public','real_estate_archive_20260810','security_archive_20260810') or (n.nspname='auth' and c.relname='users') or (n.nspname='storage' and c.relname='objects'))
  loop
    select string_agg(quote_ident(attname),',' order by attnum) into columns_sql from pg_attribute where attrelid=t.oid and attnum>0 and not attisdropped;
    insert into stackmint_release_before values(t.nspname,t.relname,columns_sql,pg_temp.stackmint_release_fingerprint(t.nspname,t.relname,columns_sql));
  end loop;
end;
$baseline$;
`;
const directory = path.join(root, "supabase/proposals");
const parts = fs.readdirSync(directory).filter((name) => /^\d{2}-.+\.sql$/.test(name)).sort().map((name) => {
  const sql = fs.readFileSync(path.join(directory, name), "utf8").replace(/\r\n/g, "\n");
  if ((sql.match(/^begin;$/gm) ?? []).length !== 1 || (sql.match(/^commit;$/gm) ?? []).length !== 1) throw new Error("Unexpected transaction structure: " + name);
  return "\n-- " + name + "\n" + sql.replace(/^begin;\n/m, "").replace(/^commit;\n?$/m, "").replace(/^-- PROPOSAL ONLY:.*\n/m, "");
});
const after = `
do $preserved$
declare original record;
begin
  for original in select * from stackmint_release_before loop
    if pg_temp.stackmint_release_fingerprint(original.schema_name,original.table_name,original.original_columns) is distinct from original.fingerprint then
      raise exception 'Release cancelled: an original row or field changed';
    end if;
  end loop;
  if exists(select 1 from public.record_revisions) then
    raise exception 'Release cancelled: fabricated historical revisions';
  end if;
end;
$preserved$;
notify pgrst, 'reload schema';
`;
fs.writeFileSync(path.join(migrationDirectory, files[0]), before + parts.join("\n") + after);
console.log("Packaged " + parts.length + " reviewed schema steps with original-field preservation checks: " + files[0]);
