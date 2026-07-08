import type { DocumentMeta, SciDocument } from '../types';

const INDEX_KEY = 'scidoc:index';
const DOC_PREFIX = 'scidoc:doc:';

export function makeDocId(): string {
  return `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function newDocument(title = 'Untitled document'): SciDocument {
  const now = Date.now();
  return {
    id: makeDocId(),
    title,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    citations: {},
    citationStyle: 'numeric',
    createdAt: now,
    updatedAt: now,
  };
}

export function loadIndex(): DocumentMeta[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as DocumentMeta[]) : [];
  } catch {
    return [];
  }
}

function saveIndex(index: DocumentMeta[]) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

export function loadDocument(id: string): SciDocument | null {
  try {
    const raw = localStorage.getItem(DOC_PREFIX + id);
    return raw ? (JSON.parse(raw) as SciDocument) : null;
  } catch {
    return null;
  }
}

export function saveDocument(doc: SciDocument) {
  localStorage.setItem(DOC_PREFIX + doc.id, JSON.stringify(doc));
  const index = loadIndex().filter((m) => m.id !== doc.id);
  index.unshift({
    id: doc.id,
    title: doc.title,
    updatedAt: doc.updatedAt,
    citationCount: Object.keys(doc.citations).length,
  });
  saveIndex(index);
}

export function deleteDocument(id: string) {
  localStorage.removeItem(DOC_PREFIX + id);
  saveIndex(loadIndex().filter((m) => m.id !== id));
}

/** Export the self-contained bundle as a downloadable .scidoc.json file. */
export function exportDocument(doc: SciDocument) {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${doc.title.replace(/[^\w\s-]/g, '').trim() || 'document'}.scidoc.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Import a .scidoc.json bundle; assigns a fresh id to avoid collisions. */
export async function importDocument(file: File): Promise<SciDocument> {
  const text = await file.text();
  const parsed = JSON.parse(text) as SciDocument;
  if (!parsed.content || typeof parsed.citations !== 'object') {
    throw new Error('Not a valid SciDoc file');
  }
  const doc: SciDocument = {
    ...parsed,
    id: makeDocId(),
    citationStyle: parsed.citationStyle ?? 'numeric',
    title: parsed.title || 'Imported document',
    updatedAt: Date.now(),
  };
  saveDocument(doc);
  return doc;
}
