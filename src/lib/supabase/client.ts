import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./v2-types";
import { releaseHeaders } from "./release-headers";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createBrowserClient<Database>(
  supabaseUrl,
  supabaseAnonKey,
  { global: { headers: releaseHeaders } },
);
