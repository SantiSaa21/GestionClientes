import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function createSupabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("Missing env NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceRoleKey) throw new Error("Missing env SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, serviceRoleKey) as SupabaseClient;
}

export function createSupabaseAnonServer(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) throw new Error("Missing env NEXT_PUBLIC_SUPABASE_URL");
  if (!anonKey) throw new Error("Missing env NEXT_PUBLIC_SUPABASE_ANON_KEY");

  return createClient(url, anonKey) as SupabaseClient;
}

export function createSupabaseAuthedServer(accessToken: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) throw new Error("Missing env NEXT_PUBLIC_SUPABASE_URL");
  if (!anonKey) throw new Error("Missing env NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!accessToken) throw new Error("Missing access token");

  return createClient(url, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }) as SupabaseClient;
}
