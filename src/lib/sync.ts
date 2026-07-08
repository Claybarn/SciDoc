import { supabase } from './supabase';
import { loadDocument, loadIndex, saveDocument } from './storage';
import type { SciDocument } from '../types';

interface RemoteRow {
  id: string;
  bundle: SciDocument;
  updated_at: string;
}

/** Upsert one document bundle to the cloud. No-op when signed out. */
export async function pushDocument(doc: SciDocument): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('documents').upsert({
    id: doc.id,
    title: doc.title,
    bundle: doc,
    updated_at: new Date(doc.updatedAt).toISOString(),
  });
  if (error) throw new Error(error.message);
}

export async function deleteRemoteDocument(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('documents').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Two-way sync with last-write-wins per document:
 * newer remote copies are written to localStorage, newer local copies
 * are pushed up. Returns how many documents moved in each direction.
 */
export async function fullSync(): Promise<{ pulled: number; pushed: number }> {
  if (!supabase) return { pulled: 0, pushed: 0 };

  const { data, error } = await supabase.from('documents').select('id, bundle, updated_at');
  if (error) throw new Error(error.message);
  const remote = new Map<string, RemoteRow>((data as RemoteRow[]).map((r) => [r.id, r]));

  let pulled = 0;
  let pushed = 0;
  const toPush: SciDocument[] = [];

  for (const row of remote.values()) {
    const local = loadDocument(row.id);
    if (!local || row.bundle.updatedAt > local.updatedAt) {
      saveDocument(row.bundle);
      pulled++;
    } else if (local.updatedAt > row.bundle.updatedAt) {
      toPush.push(local);
    }
  }

  for (const meta of loadIndex()) {
    if (!remote.has(meta.id)) {
      const local = loadDocument(meta.id);
      if (local) toPush.push(local);
    }
  }

  if (toPush.length > 0) {
    const { error: pushError } = await supabase.from('documents').upsert(
      toPush.map((doc) => ({
        id: doc.id,
        title: doc.title,
        bundle: doc,
        updated_at: new Date(doc.updatedAt).toISOString(),
      })),
    );
    if (pushError) throw new Error(pushError.message);
    pushed = toPush.length;
  }

  return { pulled, pushed };
}
