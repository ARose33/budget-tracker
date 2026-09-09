import { authRedirect } from "@/lib/auth/return-path";
import { createServerClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createServerClient();
  await supabase.auth.signOut();
  return authRedirect("/login");
}
