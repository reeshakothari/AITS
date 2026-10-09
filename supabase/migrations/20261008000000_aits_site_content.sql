-- AITS website content store (aits_ prefix keeps it separate from other apps in the same project).
-- Each content key (home, wash, fleet, vision, investors, contact, settings, global) has a 'draft' row
-- edited by admins and a 'published' row that the public site reads. aits_publish_site() copies drafts to published.

create table if not exists public.aits_site_content (
  key text not null,
  status text not null check (status in ('draft', 'published')),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  primary key (key, status)
);

-- The table may already exist from an earlier, simpler setup: add the audit column if it is missing.
alter table public.aits_site_content
  add column if not exists updated_by uuid references auth.users (id) on delete set null default auth.uid();

create table if not exists public.aits_site_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.aits_site_publish_history (
  id bigint generated always as identity primary key,
  published_at timestamptz not null default now(),
  published_by uuid references auth.users (id) on delete set null,
  snapshot jsonb not null
);

alter table public.aits_site_content enable row level security;
alter table public.aits_site_admins enable row level security;
alter table public.aits_site_publish_history enable row level security;

create or replace function public.aits_is_site_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.aits_site_admins where user_id = auth.uid());
$$;

-- Anyone can read published content; only admins can read drafts.
-- Kept as two policies so public reads never need to call aits_is_site_admin().
drop policy if exists "read published or admin" on public.aits_site_content;
drop policy if exists "anyone reads published" on public.aits_site_content;
create policy "anyone reads published" on public.aits_site_content
  for select to anon, authenticated
  using (status = 'published');

drop policy if exists "admins read drafts" on public.aits_site_content;
create policy "admins read drafts" on public.aits_site_content
  for select to authenticated
  using (status = 'draft' and public.aits_is_site_admin());

-- Admins write drafts only. Published rows change through aits_publish_site().
drop policy if exists "admins insert drafts" on public.aits_site_content;
create policy "admins insert drafts" on public.aits_site_content
  for insert to authenticated
  with check (status = 'draft' and public.aits_is_site_admin());

drop policy if exists "admins update drafts" on public.aits_site_content;
create policy "admins update drafts" on public.aits_site_content
  for update to authenticated
  using (status = 'draft' and public.aits_is_site_admin())
  with check (status = 'draft' and public.aits_is_site_admin());

drop policy if exists "admins see admins" on public.aits_site_admins;
create policy "admins see admins" on public.aits_site_admins
  for select to authenticated
  using (public.aits_is_site_admin());

drop policy if exists "admins see history" on public.aits_site_publish_history;
create policy "admins see history" on public.aits_site_publish_history
  for select to authenticated
  using (public.aits_is_site_admin());

-- Dropped first so an earlier version with a different return type is replaced cleanly.
drop function if exists public.aits_publish_site();
create or replace function public.aits_publish_site()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  stamp timestamptz := now();
begin
  if not public.aits_is_site_admin() then
    raise exception 'Only site admins can publish' using errcode = '42501';
  end if;

  insert into public.aits_site_publish_history (published_at, published_by, snapshot)
  select stamp, auth.uid(), coalesce(jsonb_object_agg(key, data), '{}'::jsonb)
  from public.aits_site_content where status = 'draft';

  insert into public.aits_site_content (key, status, data, updated_at, updated_by)
  select key, 'published', data, stamp, auth.uid()
  from public.aits_site_content where status = 'draft'
  on conflict (key, status) do update
    set data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by;

  return stamp;
end;
$$;

drop function if exists public.aits_discard_draft();
create or replace function public.aits_discard_draft()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.aits_is_site_admin() then
    raise exception 'Only site admins can discard drafts' using errcode = '42501';
  end if;

  insert into public.aits_site_content (key, status, data, updated_at, updated_by)
  select key, 'draft', data, now(), auth.uid()
  from public.aits_site_content where status = 'published'
  on conflict (key, status) do update
    set data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
end;
$$;

revoke all on function public.aits_publish_site() from public, anon;
revoke all on function public.aits_discard_draft() from public, anon;
grant execute on function public.aits_publish_site() to authenticated;
grant execute on function public.aits_discard_draft() to authenticated;
grant execute on function public.aits_is_site_admin() to anon, authenticated;

-- Public bucket for images uploaded from the editor.
insert into storage.buckets (id, name, public)
values ('aits-media', 'aits-media', true)
on conflict (id) do update set public = true;

drop policy if exists "aits media admin insert" on storage.objects;
create policy "aits media admin insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'aits-media' and public.aits_is_site_admin());

drop policy if exists "aits media admin update" on storage.objects;
create policy "aits media admin update" on storage.objects
  for update to authenticated
  using (bucket_id = 'aits-media' and public.aits_is_site_admin());

drop policy if exists "aits media admin delete" on storage.objects;
create policy "aits media admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'aits-media' and public.aits_is_site_admin());
