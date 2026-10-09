import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverEnv } from './env';
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

const TABLE = 'aits_site_content';
const HISTORY = 'aits_site_publish_history';
export const BUCKET = 'aits-media';

export const hasSupabase = () => Boolean(serverEnv.supabaseUrl() && (serverEnv.supabaseServiceKey() || serverEnv.supabaseAnonKey()));
/** Drafts and writes need the server-only service key; it never reaches the browser. */
export const canWrite = () => Boolean(serverEnv.supabaseUrl() && serverEnv.supabaseServiceKey());
/** Local demo store, used only in `astro dev` when Supabase is not configured. */
export const demoMode = () => import.meta.env.DEV && !hasSupabase();

let cached: SupabaseClient | null = null;
function db(): SupabaseClient {
  cached ??= createClient(serverEnv.supabaseUrl(), serverEnv.supabaseServiceKey() || serverEnv.supabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Stored values win; fields added to the defaults later still get their default value. Arrays are replaced whole. */
function merge<T>(base: T, over: unknown): T {
  if (!isObj(base) || !isObj(over)) return (over === undefined || over === null ? base : over) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? merge((base as Record<string, unknown>)[k], v) : v;
  return out as T;
}

function applyRows(rows: { key: string; data: unknown }[]): Content {
  const content = structuredClone(defaults) as Record<string, unknown>;
  for (const row of rows) {
    if (row.key in content) content[row.key] = merge(content[row.key], row.data);
  }
  return content as Content;
}

/* ---------------- demo store (local dev only) ---------------- */

const demoFile = (status: string) => `.astro/demo-${status}.json`;
async function readDemo(status: 'published' | 'draft'): Promise<Record<string, unknown> | null> {
  const fs = await import('node:fs/promises');
  try { return JSON.parse(await fs.readFile(demoFile(status), 'utf8')); } catch { return null; }
}
async function writeDemo(status: 'published' | 'draft', data: unknown) {
  const fs = await import('node:fs/promises');
  await fs.mkdir('.astro', { recursive: true });
  await fs.writeFile(demoFile(status), JSON.stringify(data, null, 2));
}

/* ---------------- reads ---------------- */

async function rows(status: 'published' | 'draft'): Promise<{ key: string; data: unknown }[]> {
  if (demoMode()) {
    const stored = await readDemo(status);
    return Object.entries(stored ?? {}).map(([key, data]) => ({ key, data }));
  }
  if (!hasSupabase()) return [];
  const { data, error } = await db().from(TABLE).select('key,data').eq('status', status);
  if (error) {
    console.error(`[content] Supabase read of ${status} failed, using local defaults:`, error.message);
    return [];
  }
  return data ?? [];
}

export async function loadContent(status: 'published' | 'draft' = 'published'): Promise<Content> {
  const published = await rows('published');
  if (status === 'published' || (!demoMode() && !canWrite())) return applyRows(published);
  // Keys never edited have no draft row yet; show what is live for those.
  const byKey = new Map(published.map((r) => [r.key, r]));
  for (const d of await rows('draft')) byKey.set(d.key, d);
  return applyRows([...byKey.values()]);
}

/* ---------------- writes (admin API only) ---------------- */

export async function saveDraft(key: ContentKey, data: unknown) {
  if (demoMode()) {
    const draft = (await readDemo('draft')) ?? (await readDemo('published')) ?? {};
    draft[key] = data;
    return writeDemo('draft', draft);
  }
  const { error } = await db().from(TABLE).upsert(
    { key, status: 'draft', data, updated_at: new Date().toISOString() },
    { onConflict: 'key,status' },
  );
  if (error) throw new Error(error.message);
}

export async function publishDrafts(): Promise<string> {
  const stamp = new Date().toISOString();
  if (demoMode()) {
    await writeDemo('published', await loadContent('draft'));
    return stamp;
  }
  const drafts = await rows('draft');
  if (!drafts.length) return stamp;
  const { error } = await db().from(TABLE).upsert(
    drafts.map((d) => ({ key: d.key, status: 'published', data: d.data, updated_at: stamp })),
    { onConflict: 'key,status' },
  );
  if (error) throw new Error(error.message);
  // Keep a snapshot when the history table exists; publishing does not depend on it.
  const { error: historyError } = await db().from(HISTORY).insert({
    published_at: stamp, snapshot: Object.fromEntries(drafts.map((d) => [d.key, d.data])),
  });
  if (historyError) console.warn('[content] publish history not recorded:', historyError.message);
  return stamp;
}

/** Drops all drafts, so the editor shows what is live again. */
export async function discardDrafts() {
  if (demoMode()) return writeDemo('draft', (await readDemo('published')) ?? {});
  const { error } = await db().from(TABLE).delete().eq('status', 'draft');
  if (error) throw new Error(error.message);
}

/** True when the draft differs from what is live. */
export async function hasUnpublished() {
  return JSON.stringify(await loadContent('draft')) !== JSON.stringify(await loadContent('published'));
}

export async function demoUpload(name: string, base64: string) {
  const fs = await import('node:fs/promises');
  const file = `${Date.now()}-${name}`;
  await fs.mkdir('public/images/uploads', { recursive: true });
  await fs.writeFile(`public/images/uploads/${file}`, Buffer.from(base64, 'base64'));
  return `/images/uploads/${file}`;
}

/** A one-time URL the browser uploads the image to directly, so large files skip the server body limit. */
export async function signedUpload(name: string) {
  const path = `${Date.now()}-${name}`;
  const { data, error } = await db().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(error?.message ?? 'Could not prepare the upload.');
  return { signedUrl: data.signedUrl, publicUrl: db().storage.from(BUCKET).getPublicUrl(path).data.publicUrl };
}
