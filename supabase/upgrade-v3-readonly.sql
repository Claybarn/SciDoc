-- Upgrade v2 -> v3: enforce read-only "viewer" role server-side.
-- Run once in the Supabase SQL editor (after upgrade-v2.sql).

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

drop policy "update accessible documents" on public.documents;

create policy "update editable documents"
  on public.documents for update
  using (public.can_edit_document(id))
  with check (public.can_edit_document(id));

grant execute on function public.can_edit_document to authenticated;
