-- SciDoc cloud storage schema (v2: CRDT sync + shared documents)
-- Fresh install: run this once in the Supabase dashboard SQL editor.
-- Existing projects: run upgrade-v2.sql instead.

create table public.documents (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default '',
  -- Derived JSON snapshot of the document (content + citations + style).
  -- Kept for exports and backwards compatibility; the CRDT state is canonical.
  bundle jsonb not null,
  -- Canonical Yjs document state, base64-encoded. Null only on legacy rows.
  ydoc_state text,
  updated_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Collaborators on a document (the owner is implicit, not listed here).
create table public.document_members (
  document_id text not null references public.documents (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'editor' check (role in ('editor', 'viewer')),
  added_by uuid not null default auth.uid(),
  added_at timestamptz not null default now(),
  primary key (document_id, user_id)
);

alter table public.documents enable row level security;
alter table public.document_members enable row level security;

-- security definer so policies can consult membership without recursive RLS.
create or replace function public.can_access_document(doc_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.documents d
    where d.id = doc_id and d.user_id = auth.uid()
  ) or exists (
    select 1 from public.document_members m
    where m.document_id = doc_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_document_owner(doc_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.documents d
    where d.id = doc_id and d.user_id = auth.uid()
  );
$$;

-- Owners and editors may write; viewers may only read.
create or replace function public.can_edit_document(doc_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.documents d
    where d.id = doc_id and d.user_id = auth.uid()
  ) or exists (
    select 1 from public.document_members m
    where m.document_id = doc_id and m.user_id = auth.uid() and m.role = 'editor'
  );
$$;

-- documents: members can read and write, only the owner can create/delete.
-- The direct user_id check must stay inline: rows written via upsert
-- (INSERT ... ON CONFLICT DO UPDATE) must satisfy this SELECT policy, and
-- can_access_document() can't see a row that is still being inserted.
create policy "select accessible documents"
  on public.documents for select
  using (user_id = auth.uid() or public.can_access_document(id));

create policy "insert own documents"
  on public.documents for insert
  with check (auth.uid() = user_id);

create policy "update editable documents"
  on public.documents for update
  using (public.can_edit_document(id))
  with check (public.can_edit_document(id));

create policy "delete own documents"
  on public.documents for delete
  using (auth.uid() = user_id);

-- document_members: visible to everyone with access; only the owner manages.
create policy "select members of accessible documents"
  on public.document_members for select
  using (public.can_access_document(document_id));

create policy "owner adds members"
  on public.document_members for insert
  with check (public.is_document_owner(document_id));

create policy "owner removes members, member removes self"
  on public.document_members for delete
  using (public.is_document_owner(document_id) or user_id = auth.uid());

-- Share by email. security definer because clients cannot query auth.users.
create or replace function public.share_document(doc_id text, invitee_email text, member_role text default 'editor')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  invitee uuid;
begin
  if not public.is_document_owner(doc_id) then
    raise exception 'Only the document owner can share it';
  end if;
  select u.id into invitee from auth.users u where lower(u.email) = lower(invitee_email);
  if invitee is null then
    raise exception 'No SciDoc account found for %', invitee_email;
  end if;
  if public.is_document_owner(doc_id) and invitee = auth.uid() then
    raise exception 'You already own this document';
  end if;
  insert into public.document_members (document_id, user_id, role)
  values (doc_id, invitee, member_role)
  on conflict (document_id, user_id) do update set role = excluded.role;
end;
$$;

-- Member list with emails resolved (owner included, flagged by role 'owner').
create or replace function public.document_member_list(doc_id text)
returns table (user_id uuid, email text, role text)
language sql
security definer
set search_path = public
stable
as $$
  select d.user_id, u.email::text, 'owner'::text
  from public.documents d join auth.users u on u.id = d.user_id
  where d.id = doc_id and public.can_access_document(doc_id)
  union all
  select m.user_id, u.email::text, m.role
  from public.document_members m join auth.users u on u.id = m.user_id
  where m.document_id = doc_id and public.can_access_document(doc_id);
$$;

create index documents_user_updated on public.documents (user_id, updated_at desc);
create index document_members_user on public.document_members (user_id);

-- Realtime: collaborators exchange live edits on private channel "doc:<id>".
create policy "members read doc channels"
  on realtime.messages for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() like 'doc:%'
    and public.can_access_document(substring(realtime.topic() from 5))
  );

create policy "members write doc channels"
  on realtime.messages for insert
  to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() like 'doc:%'
    and public.can_access_document(substring(realtime.topic() from 5))
  );

-- Required because "automatically expose new tables" is disabled on this
-- project: grant Data API access to signed-in users only (RLS still applies).
grant select, insert, update, delete on public.documents to authenticated;
grant select, insert, delete on public.document_members to authenticated;
grant execute on function public.share_document to authenticated;
grant execute on function public.document_member_list to authenticated;
grant execute on function public.can_access_document to authenticated;
grant execute on function public.can_edit_document to authenticated;
grant execute on function public.is_document_owner to authenticated;
