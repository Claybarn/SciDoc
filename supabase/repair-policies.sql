-- Idempotent repair: recreates every SciDoc policy and grant from scratch.
-- Safe to run any number of times; touches no data. Use this whenever the
-- policies have drifted (e.g. a partially-applied migration).
--
-- Symptom this fixes: inserts failing with
--   new row violates row-level security policy for table "documents"
-- while updates of existing documents keep working (missing INSERT policy).

-- --- helper functions -------------------------------------------------------

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

-- --- documents ---------------------------------------------------------------

alter table public.documents enable row level security;

drop policy if exists "select own documents" on public.documents;
drop policy if exists "insert own documents" on public.documents;
drop policy if exists "update own documents" on public.documents;
drop policy if exists "delete own documents" on public.documents;
drop policy if exists "select accessible documents" on public.documents;
drop policy if exists "update accessible documents" on public.documents;
drop policy if exists "update editable documents" on public.documents;

create policy "select accessible documents"
  on public.documents for select
  using (public.can_access_document(id));

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

-- --- document_members --------------------------------------------------------

alter table public.document_members enable row level security;

drop policy if exists "select members of accessible documents" on public.document_members;
drop policy if exists "owner adds members" on public.document_members;
drop policy if exists "owner removes members, member removes self" on public.document_members;

create policy "select members of accessible documents"
  on public.document_members for select
  using (public.can_access_document(document_id));

create policy "owner adds members"
  on public.document_members for insert
  with check (public.is_document_owner(document_id));

create policy "owner removes members, member removes self"
  on public.document_members for delete
  using (public.is_document_owner(document_id) or user_id = auth.uid());

-- --- realtime (live collaboration channels) ----------------------------------

drop policy if exists "members read doc channels" on realtime.messages;
drop policy if exists "members write doc channels" on realtime.messages;

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

-- --- grants -------------------------------------------------------------------

grant select, insert, update, delete on public.documents to authenticated;
grant select, insert, delete on public.document_members to authenticated;
grant execute on function public.share_document to authenticated;
grant execute on function public.document_member_list to authenticated;
grant execute on function public.can_access_document to authenticated;
grant execute on function public.can_edit_document to authenticated;
grant execute on function public.is_document_owner to authenticated;
