-- Upgrade an existing SciDoc project from schema v1 to v2
-- (CRDT sync + shared documents). Run once in the Supabase SQL editor.
-- Existing rows keep working: ydoc_state is filled in lazily by the app
-- the first time each document syncs.

alter table public.documents add column if not exists ydoc_state text;

create table public.document_members (
  document_id text not null references public.documents (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'editor' check (role in ('editor', 'viewer')),
  added_by uuid not null default auth.uid(),
  added_at timestamptz not null default now(),
  primary key (document_id, user_id)
);

alter table public.document_members enable row level security;

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

-- Widen the v1 owner-only policies to include members.
drop policy "select own documents" on public.documents;
drop policy "update own documents" on public.documents;

create policy "select accessible documents"
  on public.documents for select
  using (public.can_access_document(id));

create policy "update accessible documents"
  on public.documents for update
  using (public.can_access_document(id))
  with check (public.can_access_document(id));

create policy "select members of accessible documents"
  on public.document_members for select
  using (public.can_access_document(document_id));

create policy "owner adds members"
  on public.document_members for insert
  with check (public.is_document_owner(document_id));

create policy "owner removes members, member removes self"
  on public.document_members for delete
  using (public.is_document_owner(document_id) or user_id = auth.uid());

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

create index document_members_user on public.document_members (user_id);

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

grant select, insert, delete on public.document_members to authenticated;
grant execute on function public.share_document to authenticated;
grant execute on function public.document_member_list to authenticated;
grant execute on function public.can_access_document to authenticated;
grant execute on function public.is_document_owner to authenticated;
