import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import { Mathematics } from '@tiptap/extension-mathematics';
import { FlaskConical } from 'lucide-react';
import 'katex/dist/katex.min.css';

import type { Session } from '@supabase/supabase-js';

import { CitationNode } from './editor/CitationNode';
import { CitationStore } from './lib/citationStore';
import { citationOrderFromContent } from './lib/format';
import { supabase } from './lib/supabase';
import { deleteRemoteDocument, fullSync, pushDocument } from './lib/sync';
import {
  deleteDocument,
  exportDocument,
  importDocument,
  loadDocument,
  loadIndex,
  newDocument,
  saveDocument,
} from './lib/storage';
import type { Citation, CitationStyle, DocumentMeta, SciDocument } from './types';

import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { CitationPanel } from './components/CitationPanel';
import { Bibliography } from './components/Bibliography';
import { MathDialog, type MathDialogState } from './components/MathDialog';
import { AccountPanel, type SyncState } from './components/AccountPanel';

import './App.css';

export default function App() {
  const [index, setIndex] = useState<DocumentMeta[]>(() => loadIndex());
  const [doc, setDoc] = useState<SciDocument | null>(() => {
    const first = loadIndex()[0];
    return first ? loadDocument(first.id) : null;
  });
  const [order, setOrder] = useState<string[]>(() =>
    doc ? citationOrderFromContent(doc.content) : [],
  );
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved');
  const [mathDialog, setMathDialog] = useState<MathDialogState | null>(null);
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
  const docRef = useRef(doc);
  docRef.current = doc;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Cloud sync ---

  const [session, setSession] = useState<Session | null>(null);
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const pushToCloud = useCallback((next: SciDocument) => {
    if (!sessionRef.current) return;
    setSyncState('syncing');
    pushDocument(next)
      .then(() => setSyncState('synced'))
      .catch((e) => {
        setSyncState('error');
        setSyncError(e instanceof Error ? e.message : 'Sync failed');
      });
  }, []);

  const runFullSync = useCallback(async () => {
    if (!sessionRef.current) return;
    setSyncState('syncing');
    try {
      const { pulled } = await fullSync();
      setSyncState('synced');
      setSyncError(null);
      if (pulled > 0) {
        setIndex(loadIndex());
        // Refresh the open document if a newer copy came down.
        const current = docRef.current;
        if (current) {
          const fresh = loadDocument(current.id);
          if (fresh && fresh.updatedAt > current.updatedAt) {
            setDoc(fresh);
            setOrder(citationOrderFromContent(fresh.content));
          }
        }
      }
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

  // Full sync whenever we become signed in.
  useEffect(() => {
    if (session) runFullSync();
  }, [session, runFullSync]);

  const scheduleSave = useCallback(
    (next: SciDocument) => {
      setSaveState('saving');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveDocument(next);
        setIndex(loadIndex());
        setSaveState('saved');
        pushToCloud(next);
      }, 500);
    },
    [pushToCloud],
  );

  const updateDoc = useCallback(
    (patch: Partial<SciDocument>) => {
      setDoc((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...patch, updatedAt: Date.now() };
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Start writing your masterpiece…' }),
      CharacterCount,
      CitationNode.configure({ store }),
      Mathematics.configure({
        inlineOptions: {
          onClick: (node, pos) =>
            setMathDialog({ kind: 'inline', pos, latex: node.attrs.latex ?? '' }),
        },
        blockOptions: {
          onClick: (node, pos) =>
            setMathDialog({ kind: 'block', pos, latex: node.attrs.latex ?? '' }),
        },
      }),
    ],
    content: doc?.content ?? undefined,
    onUpdate: ({ editor: e }) => {
      const content = e.getJSON();
      setOrder(citationOrderFromContent(content));
      updateDoc({ content });
    },
  });

  // Keep the citation chips inside the editor in sync with the bundle.
  useEffect(() => {
    store.set(doc?.citations ?? {}, order, doc?.citationStyle ?? 'numeric');
  }, [store, doc?.citations, doc?.citationStyle, order]);

  const openDoc = useCallback(
    (id: string) => {
      if (id === docRef.current?.id) return;
      const loaded = loadDocument(id);
      if (!loaded || !editor) return;
      setDoc(loaded);
      setOrder(citationOrderFromContent(loaded.content));
      editor.commands.setContent(loaded.content, { emitUpdate: false });
    },
    [editor],
  );

  const createDoc = useCallback(() => {
    const fresh = newDocument();
    saveDocument(fresh);
    pushToCloud(fresh);
    setIndex(loadIndex());
    setDoc(fresh);
    setOrder([]);
    editor?.commands.setContent(fresh.content, { emitUpdate: false });
    editor?.commands.focus();
  }, [editor, pushToCloud]);

  const removeDoc = useCallback(
    (id: string) => {
      deleteDocument(id);
      if (sessionRef.current) {
        deleteRemoteDocument(id).catch(() => {
          /* remote copy will resurface on next full sync; acceptable for now */
        });
      }
      const nextIndex = loadIndex();
      setIndex(nextIndex);
      if (docRef.current?.id === id) {
        const next = nextIndex[0] ? loadDocument(nextIndex[0].id) : null;
        setDoc(next);
        setOrder(next ? citationOrderFromContent(next.content) : []);
        if (next) editor?.commands.setContent(next.content, { emitUpdate: false });
      }
    },
    [editor],
  );

  const handleImport = useCallback(
    async (file: File) => {
      try {
        const imported = await importDocument(file);
        pushToCloud(imported);
        setIndex(loadIndex());
        setDoc(imported);
        setOrder(citationOrderFromContent(imported.content));
        editor?.commands.setContent(imported.content, { emitUpdate: false });
      } catch (e) {
        alert(e instanceof Error ? e.message : 'Import failed');
      }
    },
    [editor, pushToCloud],
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

  // --- Citation bundle operations ---

  const addCitation = useCallback(
    (c: Citation) => {
      const d = docRef.current;
      if (!d) return;
      updateDoc({ citations: { ...d.citations, [c.id]: c } });
    },
    [updateDoc],
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
      const d = docRef.current;
      if (!d) return;
      const { [id]: _, ...rest } = d.citations;
      updateDoc({ citations: rest });
    },
    [updateDoc],
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

  const words = editor?.storage.characterCount.words() ?? 0;

  return (
    <div className="app">
      <Sidebar
        docs={index}
        activeId={doc?.id ?? null}
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

      {doc && editor ? (
        <main className="workspace">
          <input
            className="doc-title"
            value={doc.title}
            placeholder="Untitled document"
            onChange={(e) => updateDoc({ title: e.target.value })}
          />
          <Toolbar
            editor={editor}
            citationStyle={doc.citationStyle}
            onStyleChange={(citationStyle: CitationStyle) => updateDoc({ citationStyle })}
            onExportBundle={() => exportDocument(doc)}
            onExportDocx={async () => (await import('./lib/exportDocx')).exportDocx(doc)}
            onExportPdf={() => window.print()}
            onInsertMath={(kind) => setMathDialog({ kind, latex: '' })}
            saveState={saveState}
            leftOpen={leftOpen}
            rightOpen={rightOpen}
            onToggleLeft={toggleLeft}
            onToggleRight={toggleRight}
          />
          <div className="editor-scroll">
            <div className="page">
              <h1 className="print-title">{doc.title || 'Untitled document'}</h1>
              <EditorContent editor={editor} />
              <Bibliography citations={doc.citations} order={order} style={doc.citationStyle} />
            </div>
          </div>
          <div className="statusbar">
            <span>{words} words</span>
            <span>
              {order.filter((id) => doc.citations[id]).length} cited ·{' '}
              {Object.keys(doc.citations).length} in bundle
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

      {doc && (
        <CitationPanel
          citations={doc.citations}
          order={order}
          collapsed={!rightOpen}
          onAdd={addCitation}
          onAddAndInsert={addAndInsert}
          onInsert={insertCitation}
          onRemove={removeCitation}
        />
      )}
    </div>
  );
}
