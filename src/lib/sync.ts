import * as Y from 'yjs';
import { supabase } from './supabase';
import { loadIndex, saveDocument } from './storage';
import {
  createYDoc,
  encodeState,
  getYDoc,
  hasLocalChanges,
  mergeRemoteState,
  persistYDoc,
  snapshotFromYDoc,
} from './docStore';
import type { SciDocument } from '../types';

interface RemoteRow {
  id: string;
  user_id: string;
  bundle: SciDocument;
  ydoc_state: string | null;
  updated_at: string;
}

function rowFor(id: string, ydoc: Y.Doc) {
  const snapshot = snapshotFromYDoc(id, ydoc);
  return {
    id,
    title: snapshot.title,
    bundle: snapshot,
    ydoc_state: encodeState(ydoc),
    updated_at: new Date().toISOString(),
  };
}

/** Push one document (CRDT state + derived snapshot). No-op when signed out. */
export async function pushDocument(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('documents').upsert(rowFor(id, getYDoc(id)));
  if (error) throw new Error(error.message);
}

export async function deleteRemoteDocument(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('documents').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Two-way sync. Unlike the old last-write-wins version, documents converge
 * by CRDT merge: concurrent edits from different devices/people interleave
 * instead of the newer copy overwriting the older one.
 *
 * Legacy remote rows (no ydoc_state yet) are adopted as-is when the document
 * is unknown locally; otherwise the local CRDT wins and upgrades the row.
 */
export async function fullSync(): Promise<{ pulled: number; pushed: number }> {
  if (!supabase) return { pulled: 0, pushed: 0 };

  const uid = (await supabase.auth.getSession()).data.session?.user.id;
  if (!uid) return { pulled: 0, pushed: 0 };

  const [docsRes, membershipRes] = await Promise.all([
    supabase.from('documents').select('id, user_id, bundle, ydoc_state, updated_at'),
    supabase.from('document_members').select('document_id, role').eq('user_id', uid),
  ]);
  if (docsRes.error) throw new Error(docsRes.error.message);
  if (membershipRes.error) throw new Error(membershipRes.error.message);

  const remote = docsRes.data as RemoteRow[];
  const myRoles = new Map(
    (membershipRes.data as { document_id: string; role: string }[]).map((m) => [
      m.document_id,
      m.role,
    ]),
  );
  // RLS only allows writes by the owner or editor members; pushing anything
  // else would fail the whole batch with a policy violation.
  const canWrite = (row: RemoteRow) => row.user_id === uid || myRoles.get(row.id) === 'editor';

  const remoteIds = new Set(remote.map((r) => r.id));
  const localIds = new Set(loadIndex().map((m) => m.id));

  let pulled = 0;
  const toPush: string[] = [];

  for (const row of remote) {
    if (!localIds.has(row.id)) {
      // New to this device.
      if (row.ydoc_state) {
        const ydoc = getYDoc(row.id);
        mergeRemoteState(ydoc, row.ydoc_state);
        persistYDoc(row.id, ydoc);
        saveDocument(snapshotFromYDoc(row.id, ydoc));
      } else {
        createYDoc(row.bundle);
        saveDocument(row.bundle);
        // Upgrade the legacy row with CRDT state, if we may write it.
        if (canWrite(row)) toPush.push(row.id);
      }
      pulled++;
      continue;
    }

    const ydoc = getYDoc(row.id);
    if (row.ydoc_state && mergeRemoteState(ydoc, row.ydoc_state)) {
      persistYDoc(row.id, ydoc);
      saveDocument(snapshotFromYDoc(row.id, ydoc));
      pulled++;
    }
    if (canWrite(row) && hasLocalChanges(ydoc, row.ydoc_state)) {
      toPush.push(row.id);
    }
  }

  for (const meta of loadIndex()) {
    if (!remoteIds.has(meta.id)) toPush.push(meta.id);
  }

  if (toPush.length > 0) {
    const { error: pushError } = await supabase
      .from('documents')
      .upsert(toPush.map((id) => rowFor(id, getYDoc(id))));
    if (pushError) throw new Error(pushError.message);
  }

  return { pulled, pushed: toPush.length };
}
