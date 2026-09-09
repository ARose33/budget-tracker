import test from "node:test";
import assert from "node:assert/strict";
import { getErrorMessage } from "../src/lib/api/errors.ts";

test("API errors omit database row details and hints", () => {
  assert.equal(
    getErrorMessage({
      message: "Record changed; reload",
      details: "PRIVATE FINANCIAL RECORD",
      hint: "SECRET CONNECTION",
      code: "23514",
    }),
    "Record changed; reload",
  );
  assert.equal(
    getErrorMessage(
      { details: "PRIVATE FINANCIAL RECORD", error: "INTERNAL PAYLOAD" },
      "Request failed",
    ),
    "Request failed",
  );
  assert.equal(
    getErrorMessage(new Error("Connection unavailable")),
    "Connection unavailable",
  );
});
