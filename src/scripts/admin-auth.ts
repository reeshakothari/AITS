import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** The server reads this cookie to render drafts; Supabase keeps the full session in localStorage. */
export function setAdminCookie(name: string, token: string | null) {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = token
    ? `${name}=${token}; Path=/; Max-Age=3600; SameSite=Lax${secure}`
    : `${name}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

let client: SupabaseClient | null = null;

export function adminClient(url: string, key: string, cookieName: string): SupabaseClient {
  if (client) return client;
  client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  client.auth.onAuthStateChange((_event, session) => setAdminCookie(cookieName, session?.access_token ?? null));
  return client;
}
