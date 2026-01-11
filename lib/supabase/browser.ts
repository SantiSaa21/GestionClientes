import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function createSupabaseBrowser() {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  cached = createClient(url, anon) as SupabaseClient;
  return cached;
}

export const supabase = createSupabaseBrowser();
