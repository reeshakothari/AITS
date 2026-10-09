// Server-only settings. Read at runtime from process.env (Vercel) with the build-time value as fallback (astro dev).
const pick = (buildValue: string | undefined, name: string) =>
  (typeof process !== 'undefined' ? process.env[name] : undefined) || buildValue || '';

export const serverEnv = {
  supabaseUrl: () => pick(import.meta.env.PUBLIC_SUPABASE_URL, 'PUBLIC_SUPABASE_URL'),
  supabaseAnonKey: () => pick(import.meta.env.PUBLIC_SUPABASE_ANON_KEY, 'PUBLIC_SUPABASE_ANON_KEY'),
  supabaseServiceKey: () => pick(import.meta.env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY'),
  adminEmail: () => pick(import.meta.env.ADMIN_EMAIL, 'ADMIN_EMAIL'),
  adminPassword: () => pick(import.meta.env.ADMIN_PASSWORD, 'ADMIN_PASSWORD'),
  sessionSecret: () => pick(import.meta.env.ADMIN_SESSION_SECRET, 'ADMIN_SESSION_SECRET'),
};
