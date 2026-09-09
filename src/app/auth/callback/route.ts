import type { NextRequest } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { safeReturnPath, authRedirect } from "@/lib/auth/return-path";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safeReturnPath(requestUrl.searchParams.get("next"));

  if (code) {
    const supabase = await createServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return authRedirect("/login?error=callback");
  } else {
    return authRedirect("/login?error=callback");
  }

  return authRedirect(next);
}
