import * as Y from 'yjs';
import { getSchema } from '@tiptap/core';
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import { schemaExtensions } from '../editor/schemaExtensions';
import { base64ToBytes, bytesToBase64 } from './base64';
import { loadDocument } from './storage';
import type { Citation, CitationStyle, SciDocument } from '../types';

/**
 * CRDT layer: each document is backed by a Y.Doc so edits from multiple
 * devices/people merge instead of clobbering each other.
 *
 * Y.Doc layout:
 *   - XmlFragment 'content'  — the prose (bound to TipTap via Collaboration)
 *   - Map 'meta'             — title, citationStyle, createdAt
 *   - Map 'citations'        — citation id -> Citation (plain JSON)
 */

const YDOC_PREFIX = 'scidoc:ydoc:';

const schema = getSchema(schemaExtensions);

/** One Y.Doc instance per document id for the lifetime of the tab. */
const cache = new Map<string, Y.Doc>();

export function contentFragment(ydoc: Y.Doc): Y.XmlFragment {
  return ydoc.getXmlFragment('content');
}

export function metaMap(ydoc: Y.Doc): Y.Map<unknown> {
  return ydoc.getMap('meta');
}

export function citationsMap(ydoc: Y.Doc): Y.Map<Citation> {
  return ydoc.getMap<Citation>('citations');
}

function seedFromSnapshot(ydoc: Y.Doc, doc: SciDocument) {
  ydoc.transact(() => {
    prosemirrorJSONToYXmlFragment(schema, doc.content, contentFragment(ydoc));
    const meta = metaMap(ydoc);
    meta.set('title', doc.title);
    meta.set('citationStyle', doc.citationStyle);
    meta.set('createdAt', doc.createdAt);
    const cits = citationsMap(ydoc);
    for (const [id, c] of Object.entries(doc.citations)) cits.set(id, c);
  }, 'seed');
}

/**
 * Get (or lazily create) the Y.Doc for a document. Priority:
 * persisted CRDT state, else seed from the legacy JSON snapshot, else empty.
 */
export function getYDoc(id: string): Y.Doc {
  const cached = cache.get(id);
  if (cached) return cached;

  const ydoc = new Y.Doc();
  const persisted = localStorage.getItem(YDOC_PREFIX + id);
  if (persisted) {
    Y.applyUpdate(ydoc, base64ToBytes(persisted), 'local-store');
  } else {
    const legacy = loadDocument(id);
    if (legacy) seedFromSnapshot(ydoc, legacy);
  }
  cache.set(id, ydoc);
  return ydoc;
}

/** Create and seed a Y.Doc for a brand-new or imported document. */
export function createYDoc(doc: SciDocument): Y.Doc {
  dropYDoc(doc.id);
  const ydoc = new Y.Doc();
  seedFromSnapshot(ydoc, doc);
  cache.set(doc.id, ydoc);
  persistYDoc(doc.id, ydoc);
  return ydoc;
}

export function persistYDoc(id: string, ydoc: Y.Doc) {
  localStorage.setItem(YDOC_PREFIX + id, bytesToBase64(Y.encodeStateAsUpdate(ydoc)));
}

export function dropYDoc(id: string) {
  cache.get(id)?.destroy();
  cache.delete(id);
  localStorage.removeItem(YDOC_PREFIX + id);
}

/** Derive the self-contained JSON snapshot (exports, sidebar, legacy path). */
export function snapshotFromYDoc(id: string, ydoc: Y.Doc): SciDocument {
  const meta = metaMap(ydoc);
  const fragment = contentFragment(ydoc);
  const content =
    fragment.length > 0
      ? yXmlFragmentToProsemirrorJSON(fragment)
      : { type: 'doc', content: [{ type: 'paragraph' }] };
  return {
    id,
    title: (meta.get('title') as string) ?? '',
    content,
    citations: citationsMap(ydoc).toJSON() as Record<string, Citation>,
    citationStyle: (meta.get('citationStyle') as CitationStyle) ?? 'numeric',
    createdAt: (meta.get('createdAt') as number) ?? Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Merge a remote base64-encoded Yjs state into the local doc.
 * Returns true when the remote contained changes we didn't have.
 */
export function mergeRemoteState(ydoc: Y.Doc, stateB64: string): boolean {
  const remote = base64ToBytes(stateB64);
  const before = Y.encodeStateVector(ydoc);
  const missing = Y.diffUpdate(remote, before);
  // A no-op diff still encodes a few structural bytes; check for real content.
  if (missing.byteLength <= 2) return false;
  Y.applyUpdate(ydoc, remote, 'remote-sync');
  return true;
}

/** Whether the local doc has changes the given remote state lacks. */
export function hasLocalChanges(ydoc: Y.Doc, remoteStateB64: string | null): boolean {
  if (!remoteStateB64) return true;
  const remoteSv = Y.encodeStateVectorFromUpdate(base64ToBytes(remoteStateB64));
  return Y.encodeStateAsUpdate(ydoc, remoteSv).byteLength > 2;
}

export function encodeState(ydoc: Y.Doc): string {
  return bytesToBase64(Y.encodeStateAsUpdate(ydoc));
}
