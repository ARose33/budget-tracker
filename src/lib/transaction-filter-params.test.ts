import assert from "node:assert/strict";
import test from "node:test";

import {
  parseTransactionFilters,
  updateTransactionFilterParams,
} from "./transaction-filter-params.ts";

test("parses the three categorization statuses", () => {
  for (const status of ["uncategorized", "pending", "final"] as const) {
    assert.equal(
      parseTransactionFilters(new URLSearchParams({ status })).status,
      status
    );
  }
});

test("maps the legacy uncategorized link to the new status", () => {
  const filters = parseTransactionFilters(
    new URLSearchParams({ uncategorized: "true" })
  );

  assert.equal(filters.status, "uncategorized");
});

test("writes only the new status parameter", () => {
  const params = updateTransactionFilterParams(
    new URLSearchParams({ uncategorized: "true" }),
    { status: "pending" }
  );

  assert.equal(params.get("status"), "pending");
  assert.equal(params.has("uncategorized"), false);
});
