import { supabase } from './supabase';

export type MemberRole = 'owner' | 'editor' | 'viewer';

export interface DocumentMember {
  user_id: string;
  email: string;
  role: MemberRole;
}

/** Invite a member, or change an existing member's role (upsert semantics). */
export async function shareDocument(
  docId: string,
  email: string,
  role: 'editor' | 'viewer' = 'editor',
): Promise<void> {
  if (!supabase) throw new Error('Cloud sync is not configured');
  const { error } = await supabase.rpc('share_document', {
    doc_id: docId,
    invitee_email: email,
    member_role: role,
  });
  if (error) throw new Error(error.message);
}

/**
 * The signed-in user's role for a document. Documents that don't exist in
 * the cloud (local-only) are treated as owned.
 */
export async function myRole(docId: string, selfId: string): Promise<MemberRole> {
  const members = await listMembers(docId);
  return members.find((m) => m.user_id === selfId)?.role ?? 'owner';
}

export async function listMembers(docId: string): Promise<DocumentMember[]> {
  if (!supabase) throw new Error('Cloud sync is not configured');
  const { data, error } = await supabase.rpc('document_member_list', { doc_id: docId });
  if (error) throw new Error(error.message);
  return (data ?? []) as DocumentMember[];
}

export async function removeMember(docId: string, userId: string): Promise<void> {
  if (!supabase) throw new Error('Cloud sync is not configured');
  const { error } = await supabase
    .from('document_members')
    .delete()
    .eq('document_id', docId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
}
