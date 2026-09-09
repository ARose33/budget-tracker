/** Accept only an ordinary same-origin path, including after URL decoding. */
export function authRedirect(path: string) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: safeReturnPath(path),
      "Cache-Control": "private, no-store",
    },
  });
}

export function safeReturnPath(
  value: string | null | undefined,
  fallback = "/budget",
): string {
  if (!value || value.length > 2048) return fallback;
  try {
    let decoded = value;
    for (let i = 0; i < 3; i++) {
      if (
        !decoded.startsWith("/") ||
        decoded.startsWith("//") ||
        /[\\\u0000-\u001f\u007f]/.test(decoded)
      )
        return fallback;
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
    if (
      !decoded.startsWith("/") ||
      decoded.startsWith("//") ||
      /[\\\u0000-\u001f\u007f]/.test(decoded)
    )
      return fallback;
    const url = new URL(value, "https://stackmint.invalid");
    if (url.origin !== "https://stackmint.invalid") return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
