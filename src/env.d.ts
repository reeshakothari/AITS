/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_SUPABASE_URL?: string;
  readonly PUBLIC_SUPABASE_ANON_KEY?: string;
  readonly SUPABASE_SERVICE_ROLE_KEY?: string;
  readonly ADMIN_EMAIL?: string;
  readonly ADMIN_PASSWORD?: string;
  readonly ADMIN_SESSION_SECRET?: string;
}

declare namespace App {
  interface Locals {
    /** True when a page is rendered inside the admin editor */
    editing?: boolean;
    /** Set by the editor route: which page is open and whether the draft differs from the live site */
    editorMeta?: { page: string; unpublished: boolean };
  }
}
