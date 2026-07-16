import * as Y from 'yjs';
import { supabase } from './supabase';
import { loadIndex, saveDocument, setDocumentOwner } from './storage';
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

/**
 * Placeholder owner for documents whose cloud row is invisible to us (owned
 * by another account with no membership). Any value differing from the
 * signed-in user id keeps the document local/read-only for this account.
 */
const FOREIGN_OWNER = 'foreign';

/** A write rejected by row-level security (as opposed to network issues). */
export function isPermissionError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  return /row-level security|permission denied/i.test(msg);
}

/** Push one document (CRDT state + derived snapshot). No-op when signed out. */
export async function pushDocument(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('documents').upsert(rowFor(id, getYDoc(id)));
  if (error) {
    const err = new Error(error.message);
    // The row exists under an account we can't see into; remember that so
    // we stop retrying a push that can never succeed.
    if (isPermissionError(err)) setDocumentOwner(id, FOREIGN_OWNER);
    throw err;
  }
  // A successful push with no recorded owner means we just created the row.
  const uid = (await supabase.auth.getSession()).data.session?.user.id;
  const meta = loadIndex().find((m) => m.id === id);
  if (uid && meta && !meta.ownerId) setDocumentOwner(id, uid);
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
        saveDocument(snapshotFromYDoc(row.id, ydoc), row.user_id);
      } else {
        createYDoc(row.bundle);
        saveDocument(row.bundle, row.user_id);
        // Upgrade the legacy row with CRDT state, if we may write it.
        if (canWrite(row)) toPush.push(row.id);
      }
      pulled++;
      continue;
    }

    setDocumentOwner(row.id, row.user_id);
    const ydoc = getYDoc(row.id);
    if (row.ydoc_state && mergeRemoteState(ydoc, row.ydoc_state)) {
      persistYDoc(row.id, ydoc);
      saveDocument(snapshotFromYDoc(row.id, ydoc), row.user_id);
      pulled++;
    }
    if (canWrite(row) && hasLocalChanges(ydoc, row.ydoc_state)) {
      toPush.push(row.id);
    }
  }

  for (const meta of loadIndex()) {
    if (remoteIds.has(meta.id)) continue;
    // Invisible to us but possibly existing under another account that
    // shares this browser's localStorage — pushing would hit RLS.
    if (meta.ownerId && meta.ownerId !== uid) continue;
    toPush.push(meta.id);
  }

  let pushed = 0;
  if (toPush.length > 0) {
    const rows = toPush.map((id) => rowFor(id, getYDoc(id)));
    const markOwned = (id: string) => {
      // A row we just created (rather than updated) is now ours.
      if (!remoteIds.has(id)) setDocumentOwner(id, uid);
    };

    const { error: pushError } = await supabase.from('documents').upsert(rows);
    if (!pushError) {
      pushed = toPush.length;
      toPush.forEach(markOwned);
    } else {
      // One rejected row fails a batched upsert; retry row-by-row so a
      // single unwritable document can't block everything else.
      let hardError: string | null = null;
      for (const row of rows) {
        const { error: rowError } = await supabase.from('documents').upsert(row);
        if (rowError) {
          if (isPermissionError(rowError.message)) {
            setDocumentOwner(row.id, FOREIGN_OWNER);
          } else {
            hardError = rowError.message;
          }
        } else {
          pushed++;
          markOwned(row.id);
        }
      }
      if (pushed === 0 && hardError) throw new Error(hardError);
    }
  }

  // Re-probe documents previously marked foreign. If the mark came from a
  // since-repaired server policy (or access has been granted), one clean
  // push clears it; genuinely foreign documents just fail quietly again.
  for (const meta of loadIndex()) {
    if (meta.ownerId !== FOREIGN_OWNER || remoteIds.has(meta.id)) continue;
    const { error: probeError } = await supabase
      .from('documents')
      .upsert(rowFor(meta.id, getYDoc(meta.id)));
    if (!probeError) {
      setDocumentOwner(meta.id, uid);
      pushed++;
    }
  }

  return { pulled, pushed };
}
