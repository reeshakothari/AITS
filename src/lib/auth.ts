// Admin login backed by ADMIN_EMAIL / ADMIN_PASSWORD. A successful login gets a signed, expiring session cookie.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AstroCookies } from 'astro';
import { serverEnv } from './env';
import { sessionsValidAfter } from './content';

export const SESSION_COOKIE = 'aits-admin';
const SESSION_HOURS = 12;

export const adminConfigured = () =>
  Boolean(serverEnv.adminEmail() && serverEnv.adminPassword() && serverEnv.sessionSecret());

// Keyed with the password too, so changing ADMIN_PASSWORD signs every existing session out.
const sign = (payload: string) =>
  createHmac('sha256', `${serverEnv.sessionSecret()}:${serverEnv.adminPassword()}`).update(payload).digest('base64url');

/** Constant-time comparison that also hides length differences. */
function same(a: string, b: string) {
  const key = serverEnv.sessionSecret();
  const ha = createHmac('sha256', key).update(a).digest();
  const hb = createHmac('sha256', key).update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function checkCredentials(email: string, password: string) {
  if (!adminConfigured()) return false;
  const emailOk = same(email.trim().toLowerCase(), serverEnv.adminEmail().trim().toLowerCase());
  const passwordOk = same(password, serverEnv.adminPassword());
  return emailOk && passwordOk;
}

export function startSession(cookies: AstroCookies, secure: boolean) {
  const expires = Date.now() + SESSION_HOURS * 3600_000;
  const payload = `v1.${expires}`;
  cookies.set(SESSION_COOKIE, `${payload}.${sign(payload)}`, {
    path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: SESSION_HOURS * 3600,
  });
}

export function endSession(cookies: AstroCookies) {
  cookies.delete(SESSION_COOKIE, { path: '/' });
}

/** Valid signature, not expired, and issued after the last logout. */
export async function hasSession(cookies: AstroCookies) {
  if (!adminConfigured()) return false;
  const token = cookies.get(SESSION_COOKIE)?.value ?? '';
  const [v, expires, sig] = token.split('.');
  if (v !== 'v1' || !expires || !sig) return false;
  const expected = sign(`${v}.${expires}`);
  const ok = sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!ok || Number(expires) <= Date.now()) return false;
  const issued = Number(expires) - SESSION_HOURS * 3600_000;
  // If the sign-out time cannot be read, fail closed.
  return sessionsValidAfter().then((after) => issued > after, () => false);
}

/** Rejects cross-site requests to the admin API. */
export function sameOrigin(request: Request, url: URL) {
  const origin = request.headers.get('origin');
  if (origin) {
    // Behind Vercel's proxy `url` can carry an internal host, so compare against the host the browser used.
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host;
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return request.headers.get('sec-fetch-site') === 'same-origin';
}
