// Local-only stand-in for Supabase so the editor can be tried in `astro dev` before Supabase is connected.
import type { APIRoute } from 'astro';
import { demoMode, loadContent, readDemo, writeDemo, type Content } from '../../../lib/content';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  if (!demoMode) return json({ error: 'Demo mode is only available in local development without Supabase.' }, 404);
  const body = await request.json();

  if (body.action === 'save') {
    const draft = (await readDemo('draft')) ?? (await loadContent('draft'));
    (draft as Record<string, unknown>)[body.key] = body.data;
    await writeDemo('draft', draft as Partial<Content>);
    return json({ ok: true });
  }
  if (body.action === 'publish') {
    await writeDemo('published', await loadContent('draft'));
    return json({ ok: true, publishedAt: new Date().toISOString() });
  }
  if (body.action === 'discard') {
    await writeDemo('draft', await loadContent('published'));
    return json({ ok: true });
  }
  if (body.action === 'upload') {
    const fs = await import('node:fs/promises');
    const safe = String(body.name).toLowerCase().replace(/[^a-z0-9.\-]+/g, '-');
    const name = `${Date.now()}-${safe}`;
    await fs.mkdir('public/images/uploads', { recursive: true });
    await fs.writeFile(`public/images/uploads/${name}`, Buffer.from(body.base64, 'base64'));
    return json({ ok: true, url: `/images/uploads/${name}` });
  }
  return json({ error: 'Unknown action' }, 400);
};
