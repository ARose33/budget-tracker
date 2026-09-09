import test from "node:test";
import assert from "node:assert/strict";
import { safeReturnPath } from "./return-path.ts";
test("auth returns preserve legitimate month/category context", () => {
  assert.equal(
    safeReturnPath("/budget?year=2026&month=9&category=synthetic"),
    "/budget?year=2026&month=9&category=synthetic",
  );
  assert.equal(safeReturnPath("/reset-password"), "/reset-password");
});
test("auth rejects external, encoded, malformed, and control-character destinations", () => {
  for (const input of [
    "https://example.invalid",
    "//example.invalid",
    "/\\example.invalid",
    "/%2fexample.invalid",
    "/%252fexample.invalid",
    "/%5cexample.invalid",
    "/\n/example.invalid",
    "javascript:alert(1)",
    "/%xx",
    null,
  ]) {
    assert.equal(safeReturnPath(input), "/budget");
  }
});
