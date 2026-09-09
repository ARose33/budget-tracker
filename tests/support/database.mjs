import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Every instance is explicitly disposable. Never accept an environment URL,
// filesystem data directory, or production client.
export async function createTestDatabase() {
  const db = new PGlite();
  await db.exec(await fs.readFile(new URL("../fixtures/schema.sql", import.meta.url), "utf8"));
  return db;
}
export const userA = "10000000-0000-4000-8000-000000000001";
export const userB = "10000000-0000-4000-8000-000000000002";
export async function asUser(db, id) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.exec("set role authenticated");
}
