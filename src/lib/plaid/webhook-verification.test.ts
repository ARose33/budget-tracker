import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { verifyPlaidWebhook } from "./webhook-verification.ts";

const { publicKey, privateKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
});
const now = 1800000000;
const body = '{"webhook_type":"TRANSACTIONS","item_id":"synthetic-item"}';
const key = {
  ...publicKey.export({ format: "jwk" }),
  kid: "synthetic-key",
  alg: "ES256",
  expired_at: null,
};
function token(overrides = {}, algorithm = "ES256") {
  const header = Buffer.from(
    JSON.stringify({ alg: algorithm, kid: key.kid }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iat: now,
      request_body_sha256: createHash("sha256").update(body).digest("hex"),
      ...overrides,
    }),
  ).toString("base64url");
  const content = header + "." + payload;
  return (
    content +
    "." +
    sign("sha256", Buffer.from(content), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    }).toString("base64url")
  );
}
test("webhooks accept a valid ES256 signature bound to the raw body", async () => {
  assert.equal(
    await verifyPlaidWebhook(token(), body, async () => key, now),
    true,
  );
});
test("webhooks reject missing, forged, expired, future, wrong-body, and wrong-algorithm requests", async () => {
  for (const candidate of [
    null,
    "bad",
    token({ iat: now - 301 }),
    token({ iat: now + 31 }),
    token({ exp: now }),
    token({}, "HS256"),
  ]) {
    assert.equal(
      await verifyPlaidWebhook(candidate, body, async () => key, now),
      false,
    );
  }
  assert.equal(
    await verifyPlaidWebhook(token(), body + " ", async () => key, now),
    false,
  );
  assert.equal(
    await verifyPlaidWebhook(
      token(),
      body,
      async () => ({ ...key, expired_at: now - 1 }),
      now,
    ),
    false,
  );
  assert.equal(
    await verifyPlaidWebhook(
      token(),
      body,
      async () => ({ ...key, kid: "wrong" }),
      now,
    ),
    false,
  );
  const other = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  }).publicKey.export({ format: "jwk" });
  assert.equal(
    await verifyPlaidWebhook(
      token(),
      body,
      async () => ({ ...key, ...other }),
      now,
    ),
    false,
  );
});
