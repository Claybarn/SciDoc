-- SciDoc cloud storage schema
-- Run this once in the Supabase dashboard: SQL Editor → New query → paste → Run.

create table public.documents (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default '',
  -- The entire self-contained SciDoc bundle (content + citations + style)
  bundle jsonb not null,
  updated_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Redundant if "automatic RLS" is enabled on the project, but harmless.
alter table public.documents enable row level security;

create policy "select own documents"
  on public.documents for select
  using (auth.uid() = user_id);

create policy "insert own documents"
  on public.documents for insert
  with check (auth.uid() = user_id);

create policy "update own documents"
  on public.documents for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "delete own documents"
  on public.documents for delete
  using (auth.uid() = user_id);

create index documents_user_updated on public.documents (user_id, updated_at desc);

-- Required because "automatically expose new tables" is disabled on this
-- project: grant Data API access to signed-in users only (RLS still applies).
grant select, insert, update, delete on public.documents to authenticated;
