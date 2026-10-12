// Admin API: login/logout plus the editor's save, publish, discard and image upload.
// Every action except login needs a valid admin session (or local demo mode).
import type { APIRoute } from 'astro';
import { checkCredentials, endSession, hasSession, sameOrigin, startSession } from '../../../lib/auth';
import { canWrite, CONTENT_KEYS, demoMode, demoUpload, discardDrafts, publishDrafts, saveDraft, signedUpload, signOutEverywhere, type ContentKey } from '../../../lib/content';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const safeName = (n: unknown) => String(n ?? 'image').toLowerCase().replace(/[^a-z0-9.\-]+/g, '-').slice(-80);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export const POST: APIRoute = async ({ params, request, cookies, url }) => {
  if (!sameOrigin(request, url)) return json({ error: 'Request blocked.' }, 403);
  const action = params.action;
  const body = await request.json().catch(() => ({}));

  if (action === 'login') {
    if (!checkCredentials(String(body.email ?? ''), String(body.password ?? ''))) {
      await new Promise((r) => setTimeout(r, 600)); // slow down guessing
      return json({ error: 'That email and password do not match.' }, 401);
    }
    startSession(cookies, url.protocol === 'https:');
    return json({ ok: true });
  }
  if (action === 'logout') {
    // Only a signed-in admin can sign everyone out; anyone may clear their own cookie.
    if (!demoMode() && (await hasSession(cookies))) await signOutEverywhere().catch((err) => console.error('[auth] sign-out not recorded:', err.message));
    endSession(cookies);
    return json({ ok: true });
  }

  if (!demoMode() && !(await hasSession(cookies))) return json({ error: 'Your session has ended. Log in again.' }, 401);
  if (!demoMode() && !canWrite()) return json({ error: 'Saving is not set up: SUPABASE_SERVICE_ROLE_KEY is missing on the server.' }, 500);

  try {
    switch (action) {
      case 'save': {
        if (!CONTENT_KEYS.includes(body.key)) return json({ error: 'Unknown content section.' }, 400);
        // Each save replaces a whole section, so an empty or malformed one would wipe it.
        if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data) || !Object.keys(body.data).length) {
          return json({ error: 'Nothing to save.' }, 400);
        }
        await saveDraft(body.key as ContentKey, body.data);
        return json({ ok: true });
      }
      case 'publish':
        return json({ ok: true, publishedAt: await publishDrafts() });
      case 'discard':
        await discardDrafts();
        return json({ ok: true });
      case 'upload': {
        if (!/^image\//.test(String(body.type))) return json({ error: 'That file is not an image.' }, 400);
        if (Number(body.size) > MAX_IMAGE_BYTES) return json({ error: 'Images must be under 8 MB.' }, 400);
        if (demoMode()) return json({ ok: true, url: await demoUpload(safeName(body.name), String(body.base64 ?? '')) });
        return json({ ok: true, ...(await signedUpload(safeName(body.name))) });
      }
      default:
        return json({ error: 'Unknown action.' }, 404);
    }
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
};
