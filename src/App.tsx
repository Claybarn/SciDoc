import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { Mathematics } from '@tiptap/extension-mathematics';
import { FlaskConical } from 'lucide-react';
import 'katex/dist/katex.min.css';

import type { Session } from '@supabase/supabase-js';

import { CitationNode } from './editor/CitationNode';
import { ImageNode } from './editor/ImageNode';
import { CitationStore } from './lib/citationStore';
import { processImageFile } from './lib/imageUtils';
import { citationOrderFromContent } from './lib/format';
import { supabase } from './lib/supabase';
import { SupabaseCollabProvider } from './lib/collabProvider';
import { myRole, removeMember, type MemberRole } from './lib/sharing';
import { deleteRemoteDocument, fullSync, isPermissionError, pushDocument } from './lib/sync';
import {
  citationsMap,
  contentFragment,
  createYDoc,
  dropYDoc,
  getYDoc,
  metaMap,
  persistYDoc,
  snapshotFromYDoc,
} from './lib/docStore';
import {
  deleteDocument,
  exportDocument,
  importDocument,
  loadIndex,
  newDocument,
  saveDocument,
} from './lib/storage';
import type { Citation, CitationStyle, DocumentMeta } from './types';

import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { CitationPanel } from './components/CitationPanel';
import { Bibliography } from './components/Bibliography';
import { MathDialog, type MathDialogState } from './components/MathDialog';
import { ShareDialog } from './components/ShareDialog';
import { AccountPanel, type SyncState } from './components/AccountPanel';

import './App.css';

const CARET_COLORS = ['#4f63f0', '#0e9488', '#c8871f', '#c0392b', '#5a3fb0', '#1f7a58', '#b0367c'];

function caretColor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return CARET_COLORS[Math.abs(h) % CARET_COLORS.length];
}

export default function App() {
  const [index, setIndex] = useState<DocumentMeta[]>(() => loadIndex());
  const [docId, setDocId] = useState<string | null>(() => loadIndex()[0]?.id ?? null);
  const ydoc = useMemo(() => (docId ? getYDoc(docId) : null), [docId]);

  // Document state mirrored out of the Y.Doc for React rendering.
  const [title, setTitle] = useState('');
  const [citations, setCitations] = useState<Record<string, Citation>>({});
  const [citationStyle, setCitationStyle] = useState<CitationStyle>('numeric');
  const [order, setOrder] = useState<string[]>([]);

  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved');
  const [mathDialog, setMathDialog] = useState<MathDialogState | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [leftOpen, setLeftOpen] = useState(() => localStorage.getItem('scidoc:ui:left') !== '0');
  const [rightOpen, setRightOpen] = useState(() => localStorage.getItem('scidoc:ui:right') !== '0');

  const toggleLeft = useCallback(() => {
    setLeftOpen((o) => {
      localStorage.setItem('scidoc:ui:left', o ? '0' : '1');
      return !o;
    });
  }, []);

  const toggleRight = useCallback(() => {
    setRightOpen((o) => {
      localStorage.setItem('scidoc:ui:right', o ? '0' : '1');
      return !o;
    });
  }, []);

  const store = useMemo(() => new CitationStore(), []);

  // --- Cloud sync + auth ---

  const [session, setSession] = useState<Session | null>(null);
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  // null = still resolving; pushes to the cloud wait until the role is known
  // so a viewer's client never attempts a write that RLS would reject.
  const [role, setRole] = useState<MemberRole | null>('owner');
  const readOnly = role === 'viewer';
  const roleRef = useRef(role);
  roleRef.current = role;

  const pushToCloud = useCallback((id: string) => {
    if (!sessionRef.current) return;
    setSyncState('syncing');
    pushDocument(id)
      .then(() => setSyncState('synced'))
      .catch((e) => {
        if (isPermissionError(e)) {
          // pushDocument recorded the document as unwritable from this
          // account; it opens view-only next time. Don't lock the editor
          // mid-session — local edits are safe in the CRDT and will sync
          // later if access is granted (or the server policy is repaired).
          setIndex(loadIndex());
          setSyncState('error');
          setSyncError(
            'The server refused to save this document from this account. ' +
              'Your changes are kept on this device. If the document belongs to ' +
              'your other account, sign in there to edit or share it.',
          );
          return;
        }
        setSyncState('error');
        setSyncError(e instanceof Error ? e.message : 'Sync failed');
      });
  }, []);

  const runFullSync = useCallback(async () => {
    if (!sessionRef.current) return;
    setSyncState('syncing');
    try {
      await fullSync();
      setSyncState('synced');
      setSyncError(null);
      // Open documents update in place: fullSync merges into the same
      // cached Y.Doc the editor is bound to.
      setIndex(loadIndex());
    } catch (e) {
      setSyncState('error');
      setSyncError(e instanceof Error ? e.message : 'Sync failed');
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) runFullSync();
  }, [session, runFullSync]);

  // --- Access role for the open document ---

  useEffect(() => {
    // Local-only docs and signed-out use are always editable.
    if (!docId || !session) {
      setRole('owner');
      return;
    }
    let cancelled = false;
    setRole(null);
    const uid = session.user.id;
    // localStorage is shared across accounts in this browser: a document the
    // cloud says belongs to someone else (and isn't shared with us) must not
    // be edited or pushed from this account.
    const belongsToOtherAccount = () => {
      const ownerId = loadIndex().find((m) => m.id === docId)?.ownerId;
      return ownerId !== undefined && ownerId !== uid;
    };
    myRole(docId, uid)
      .then((r) => {
        if (cancelled) return;
        // 'owner' is also what an empty member list (no cloud access) yields.
        const effective = r === 'owner' && belongsToOtherAccount() ? 'viewer' : r;
        setRole(effective);
        // Cover any change that was held back while the role resolved.
        if (effective !== 'viewer') pushToCloud(docId);
      })
      .catch(() => {
        // Offline or RPC missing: fall back to the local ownership hint;
        // RLS still protects the server either way.
        if (!cancelled) setRole(belongsToOtherAccount() ? 'viewer' : 'owner');
      });
    return () => {
      cancelled = true;
    };
  }, [docId, session, pushToCloud]);

  // --- Live collaboration provider (per open document, when signed in) ---

  const [provider, setProvider] = useState<SupabaseCollabProvider | null>(null);
  const [peers, setPeers] = useState<{ name: string; color: string }[]>([]);

  useEffect(() => {
    if (!ydoc || !docId || !session || !supabase) {
      setProvider(null);
      return;
    }
    const p = new SupabaseCollabProvider(ydoc, docId);
    setProvider(p);
    return () => {
      p.destroy();
      setProvider(null);
    };
  }, [ydoc, docId, session]);

  useEffect(() => {
    if (!provider) {
      setPeers([]);
      return;
    }
    const update = () => {
      const others: { name: string; color: string }[] = [];
      for (const [clientId, state] of provider.awareness.getStates()) {
        if (clientId === provider.awareness.clientID) continue;
        const user = (state as { user?: { name?: string; color?: string } }).user;
        if (user) others.push({ name: user.name ?? 'Anonymous', color: user.color ?? '#888' });
      }
      setPeers(others);
    };
    update();
    provider.awareness.on('change', update);
    return () => provider.awareness.off('change', update);
  }, [provider]);

  const caretUser = useMemo(() => {
    const email = session?.user.email ?? 'anonymous';
    return { name: email.split('@')[0], color: caretColor(email) };
  }, [session]);

  // --- Mirror Y.Doc meta + citations into React state ---

  useEffect(() => {
    if (!ydoc) {
      setTitle('');
      setCitations({});
      setCitationStyle('numeric');
      setOrder([]);
      return;
    }
    const meta = metaMap(ydoc);
    const cits = citationsMap(ydoc);
    const readMeta = () => {
      setTitle((meta.get('title') as string) ?? '');
      setCitationStyle((meta.get('citationStyle') as CitationStyle) ?? 'numeric');
    };
    const readCitations = () => setCitations(cits.toJSON() as Record<string, Citation>);
    readMeta();
    readCitations();
    meta.observe(readMeta);
    cits.observe(readCitations);
    return () => {
      meta.unobserve(readMeta);
      cits.unobserve(readCitations);
    };
  }, [ydoc]);

  // --- Persistence: any Y.Doc change (local or remote) saves + pushes ---

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!ydoc || !docId) return;
    const flush = () => {
      saveTimer.current = null;
      persistYDoc(docId, ydoc);
      saveDocument(snapshotFromYDoc(docId, ydoc));
      setIndex(loadIndex());
      setSaveState('saved');
      // Only push with a confirmed writable role; a viewer's (or unknown)
      // push would be rejected by RLS. Held-back changes go up when the
      // role resolves or on the next full sync.
      if (roleRef.current === 'owner' || roleRef.current === 'editor') pushToCloud(docId);
    };
    const onUpdate = (_update: Uint8Array, origin: unknown) => {
      if (origin === 'local-store') return;
      setSaveState('saving');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flush, 500);
    };
    ydoc.on('update', onUpdate);
    return () => {
      ydoc.off('update', onUpdate);
      // Don't lose a pending save when switching documents or unmounting.
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        flush();
      }
    };
  }, [ydoc, docId, pushToCloud]);

  // --- Images ---

  const editorRef = useRef<ReturnType<typeof useEditor> | null>(null);

  const insertImages = useCallback(async (files: File[], pos?: number) => {
    const ed = editorRef.current;
    if (!ed || !ed.isEditable) return;
    let at = pos;
    for (const file of files) {
      try {
        const { src, width, height } = await processImageFile(file);
        const content = { type: 'image', attrs: { src, width, height } };
        const chain = ed.chain().focus();
        if (at !== undefined) {
          chain.insertContentAt(at, content).run();
          at = undefined; // subsequent files follow the cursor
        } else {
          chain.insertContent(content).run();
        }
      } catch (e) {
        alert(e instanceof Error ? e.message : 'Could not insert image');
      }
    }
  }, []);

  const imageFilesFrom = (list: FileList | null | undefined): File[] =>
    Array.from(list ?? []).filter((f) => f.type.startsWith('image/'));

  // --- Editor (recreated per document / provider) ---

  const editor = useEditor(
    {
      editorProps: {
        handlePaste: (_view, event) => {
          const files = imageFilesFrom(event.clipboardData?.files);
          if (files.length === 0) return false;
          event.preventDefault();
          insertImages(files);
          return true;
        },
        handleDrop: (view, event, _slice, moved) => {
          if (moved) return false;
          const files = imageFilesFrom(event.dataTransfer?.files);
          if (files.length === 0) return false;
          event.preventDefault();
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          insertImages(files, pos);
          return true;
        },
      },
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        Placeholder.configure({ placeholder: 'Start writing your masterpiece…' }),
        CharacterCount,
        ImageNode,
        CitationNode.configure({ store }),
        Mathematics.configure({
          inlineOptions: {
            onClick: (node, pos) => {
              if (roleRef.current === 'viewer') return;
              setMathDialog({ kind: 'inline', pos, latex: node.attrs.latex ?? '' });
            },
          },
          blockOptions: {
            onClick: (node, pos) => {
              if (roleRef.current === 'viewer') return;
              setMathDialog({ kind: 'block', pos, latex: node.attrs.latex ?? '' });
            },
          },
        }),
        ...(ydoc ? [Collaboration.configure({ fragment: contentFragment(ydoc) })] : []),
        ...(provider
          ? [CollaborationCaret.configure({ provider, user: caretUser })]
          : []),
      ],
      onCreate: ({ editor: e }) => setOrder(citationOrderFromContent(e.getJSON())),
      onUpdate: ({ editor: e }) => setOrder(citationOrderFromContent(e.getJSON())),
    },
    [ydoc, provider, caretUser],
  );
  editorRef.current = editor;

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  // Keep the citation chips inside the editor in sync with the bundle.
  useEffect(() => {
    store.set(citations, order, citationStyle);
  }, [store, citations, citationStyle, order]);

  // --- Document operations ---

  const openDoc = useCallback((id: string) => {
    setDocId((current) => (id === current ? current : id));
    setShareOpen(false);
  }, []);

  const createDoc = useCallback(() => {
    const fresh = newDocument();
    createYDoc(fresh);
    saveDocument(fresh);
    setIndex(loadIndex());
    setDocId(fresh.id);
    pushToCloud(fresh.id);
  }, [pushToCloud]);

  const removeDoc = useCallback(
    (id: string) => {
      deleteDocument(id);
      dropYDoc(id);
      if (sessionRef.current) {
        // Owners delete the cloud copy; for docs shared *to* us the delete
        // no-ops, so also leave the member list — otherwise the next sync
        // would pull the document right back.
        deleteRemoteDocument(id).catch(() => {});
        removeMember(id, sessionRef.current.user.id).catch(() => {});
      }
      const nextIndex = loadIndex();
      setIndex(nextIndex);
      setDocId((current) => (current === id ? (nextIndex[0]?.id ?? null) : current));
    },
    [],
  );

  const handleImport = useCallback(
    async (file: File) => {
      try {
        const imported = await importDocument(file);
        createYDoc(imported);
        setIndex(loadIndex());
        setDocId(imported.id);
        pushToCloud(imported.id);
      } catch (e) {
        alert(e instanceof Error ? e.message : 'Import failed');
      }
    },
    [pushToCloud],
  );

  // --- Auth ---

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) return 'Cloud sync is not configured';
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    if (!supabase) return 'Cloud sync is not configured';
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return error.message;
    // No session means the project requires email confirmation first.
    return data.session ? null : 'confirm-email';
  }, []);

  const signOut = useCallback(() => {
    supabase?.auth.signOut();
    setSyncState('idle');
    setSyncError(null);
  }, []);

  // --- Citation bundle operations (write into the CRDT) ---

  const addCitation = useCallback(
    (c: Citation) => {
      if (ydoc && roleRef.current !== 'viewer') citationsMap(ydoc).set(c.id, c);
    },
    [ydoc],
  );

  const insertCitation = useCallback(
    (id: string) => {
      editor?.chain().focus().insertCitation(id).run();
    },
    [editor],
  );

  const addAndInsert = useCallback(
    (c: Citation) => {
      addCitation(c);
      insertCitation(c.id);
    },
    [addCitation, insertCitation],
  );

  const removeCitation = useCallback(
    (id: string) => {
      if (ydoc && roleRef.current !== 'viewer') citationsMap(ydoc).delete(id);
    },
    [ydoc],
  );

  // --- Equations ---

  const saveMath = useCallback(
    (latex: string) => {
      if (!editor || !mathDialog) return;
      const { kind, pos } = mathDialog;
      const chain = editor.chain().focus();
      if (pos !== undefined) {
        if (kind === 'inline') chain.updateInlineMath({ latex, pos }).run();
        else chain.updateBlockMath({ latex, pos }).run();
      } else {
        if (kind === 'inline') chain.insertInlineMath({ latex }).run();
        else chain.insertBlockMath({ latex }).run();
      }
      setMathDialog(null);
    },
    [editor, mathDialog],
  );

  const deleteMath = useCallback(() => {
    if (!editor || !mathDialog || mathDialog.pos === undefined) return;
    const { kind, pos } = mathDialog;
    const chain = editor.chain().focus();
    if (kind === 'inline') chain.deleteInlineMath({ pos }).run();
    else chain.deleteBlockMath({ pos }).run();
    setMathDialog(null);
  }, [editor, mathDialog]);

  const words =
    editor && !editor.isDestroyed ? (editor.storage.characterCount?.words() ?? 0) : 0;

  const snapshot = useCallback(() => {
    if (!docId || !ydoc) throw new Error('No document open');
    return snapshotFromYDoc(docId, ydoc);
  }, [docId, ydoc]);

  return (
    <div className="app">
      <Sidebar
        docs={index}
        activeId={docId}
        collapsed={!leftOpen}
        onSelect={openDoc}
        onCreate={createDoc}
        onDelete={removeDoc}
        onImport={handleImport}
      >
        {supabase && (
          <AccountPanel
            email={session?.user.email ?? null}
            syncState={syncState}
            syncError={syncError}
            onSignIn={signIn}
            onSignUp={signUp}
            onSignOut={signOut}
            onSyncNow={runFullSync}
          />
        )}
      </Sidebar>

      {docId && ydoc && editor ? (
        <main className="workspace">
          <input
            className="doc-title"
            value={title}
            placeholder="Untitled document"
            readOnly={readOnly}
            onChange={(e) => !readOnly && metaMap(ydoc).set('title', e.target.value)}
          />
          <Toolbar
            editor={editor}
            citationStyle={citationStyle}
            onStyleChange={(s: CitationStyle) => metaMap(ydoc).set('citationStyle', s)}
            onExportBundle={() => exportDocument(snapshot())}
            onExportDocx={async () => (await import('./lib/exportDocx')).exportDocx(snapshot())}
            onExportPdf={() => window.print()}
            onInsertMath={(kind) => setMathDialog({ kind, latex: '' })}
            onInsertImage={(files) => insertImages(files)}
            onShare={session ? () => setShareOpen(true) : undefined}
            peers={peers}
            readOnly={readOnly}
            saveState={saveState}
            leftOpen={leftOpen}
            rightOpen={rightOpen}
            onToggleLeft={toggleLeft}
            onToggleRight={toggleRight}
          />
          <div className="editor-scroll">
            <div className="page">
              <h1 className="print-title">{title || 'Untitled document'}</h1>
              <EditorContent editor={editor} />
              <Bibliography citations={citations} order={order} style={citationStyle} />
            </div>
          </div>
          <div className="statusbar">
            <span>{words} words</span>
            <span>
              {order.filter((id) => citations[id]).length} cited ·{' '}
              {Object.keys(citations).length} in bundle
            </span>
          </div>
        </main>
      ) : (
        <main className="workspace empty-state">
          <FlaskConical size={44} strokeWidth={1.2} />
          <h2>Welcome to SciDoc</h2>
          <p>Write, cite, and keep every reference bundled inside the document itself.</p>
          <button className="btn btn-primary" onClick={createDoc}>
            Create your first document
          </button>
        </main>
      )}

      {mathDialog && (
        <MathDialog
          state={mathDialog}
          onSave={saveMath}
          onDelete={deleteMath}
          onClose={() => setMathDialog(null)}
        />
      )}

      {shareOpen && docId && session && (
        <ShareDialog
          docId={docId}
          docTitle={title}
          selfId={session.user.id}
          onClose={() => setShareOpen(false)}
        />
      )}

      {docId && (
        <CitationPanel
          citations={citations}
          order={order}
          collapsed={!rightOpen}
          readOnly={readOnly}
          onAdd={addCitation}
          onAddAndInsert={addAndInsert}
          onInsert={insertCitation}
          onRemove={removeCitation}
        />
      )}
    </div>
  );
}
