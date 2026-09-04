import { createBrowserClient } from "@supabase/ssr";
import { getEnv } from "@/lib/config";

export function createBrowserSupabase() {
  const env = getEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error("Supabase is not configured");
  }
  return createBrowserClient(url, anon);
}
