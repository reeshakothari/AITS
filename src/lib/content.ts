import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import global from '../content/global.json';
import settings from '../content/settings.json';
import home from '../content/home.json';
import wash from '../content/wash.json';
import fleet from '../content/fleet.json';
import vision from '../content/vision.json';
import investors from '../content/investors.json';
import contact from '../content/contact.json';

/** Local JSON files are the defaults and the fallback when Supabase is not configured. */
export const defaults = { global, settings, home, wash, fleet, vision, investors, contact };
export type Content = typeof defaults;
export type ContentKey = keyof Content;
export const CONTENT_KEYS = Object.keys(defaults) as ContentKey[];

export const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY ?? '';
export const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** Server-side client. Pass the admin's access token to read drafts under RLS. */
export function serverClient(accessToken?: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {},
  });
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Stored values win; fields added to the defaults later still get their default value. Arrays are replaced whole. */
function merge<T>(base: T, over: unknown): T {
  if (!isObj(base) || !isObj(over)) return (over === undefined || over === null ? base : over) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? merge((base as Record<string, unknown>)[k], v) : v;
  return out as T;
}

/** Local demo store, used only in `astro dev` when Supabase is not configured. */
export const demoMode = !hasSupabase && import.meta.env.DEV;
const demoFile = (status: string) => `.astro/demo-${status}.json`;

export async function readDemo(status: 'published' | 'draft'): Promise<Partial<Content> | null> {
  if (!demoMode) return null;
  const fs = await import('node:fs/promises');
  try { return JSON.parse(await fs.readFile(demoFile(status), 'utf8')); } catch { return null; }
}
export async function writeDemo(status: 'published' | 'draft', data: Partial<Content>) {
  const fs = await import('node:fs/promises');
  await fs.mkdir('.astro', { recursive: true });
  await fs.writeFile(demoFile(status), JSON.stringify(data, null, 2));
}

function applyRows(rows: { key: string; data: unknown }[]): Content {
  const content = structuredClone(defaults) as Record<string, unknown>;
  for (const row of rows) {
    if (row.key in content) content[row.key] = merge(content[row.key], row.data);
  }
  return content as Content;
}

export async function loadContent(status: 'published' | 'draft' = 'published', accessToken?: string): Promise<Content> {
  if (demoMode) {
    const stored = (await readDemo(status)) ?? (status === 'draft' ? await readDemo('published') : null);
    return applyRows(Object.entries(stored ?? {}).map(([key, data]) => ({ key, data })));
  }
  if (!hasSupabase) return structuredClone(defaults);
  const { data, error } = await serverClient(accessToken).from('aits_site_content').select('key,data').eq('status', status);
  if (error) {
    console.error('[content] Supabase read failed, using local defaults:', error.message);
    return structuredClone(defaults);
  }
  return applyRows(data ?? []);
}

/** True when the token belongs to a signed-in user listed in aits_site_admins. */
export async function verifyAdmin(token: string | undefined): Promise<boolean> {
  if (!hasSupabase || !token) return false;
  const client = serverClient(token);
  const { data: user, error } = await client.auth.getUser(token);
  if (error || !user?.user) return false;
  const { data: isAdmin } = await client.rpc('aits_is_site_admin');
  return isAdmin === true;
}

export const ADMIN_COOKIE = 'aits-admin-token';
