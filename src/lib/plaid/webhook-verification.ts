import { createHash, createPublicKey, timingSafeEqual, verify, type JsonWebKey } from "node:crypto";

export type WebhookKey = JsonWebKey & { kid?: string; alg?: string; expired_at?: number | null };
export async function verifyPlaidWebhook(
  token: string | null,
  rawBody: string,
  lookupKey: (keyId: string) => Promise<WebhookKey>,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<boolean> {
  if (!token || token.length > 8192) return false;
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return false;
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (header.alg !== "ES256" || typeof header.kid !== "string" || !header.kid || header.kid.length > 200) return false;
    if (!Number.isFinite(payload.iat) || payload.iat < nowSeconds - 300 || payload.iat > nowSeconds + 30) return false;
    if (payload.exp !== undefined && (!Number.isFinite(payload.exp) || payload.exp <= nowSeconds)) return false;
    if (typeof payload.request_body_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(payload.request_body_sha256)) return false;
    const bodyHash = createHash("sha256").update(rawBody, "utf8").digest();
    if (!timingSafeEqual(bodyHash, Buffer.from(payload.request_body_sha256, "hex"))) return false;
    const key = await lookupKey(header.kid);
    if (key.kid !== header.kid || key.alg !== "ES256" || key.kty !== "EC" || key.crv !== "P-256" ||
        (key.expired_at != null && key.expired_at <= nowSeconds)) return false;
    const signature = Buffer.from(parts[2], "base64url");
    if (signature.length !== 64) return false;
    return verify("sha256", Buffer.from(parts[0] + "." + parts[1]),
      { key: createPublicKey({ key, format: "jwk" }), dsaEncoding: "ieee-p1363" }, signature);
  } catch { return false; }
}
