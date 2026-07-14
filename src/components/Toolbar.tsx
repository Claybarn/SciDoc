import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import {
  Bold,
  ChevronDown,
  Code,
  Download,
  FileDown,
  FileJson,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  List,
  ListOrdered,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Redo2,
  Sigma,
  SquareSigma,
  Strikethrough,
  TextQuote,
  Undo2,
  UserPlus,
} from 'lucide-react';
import type { CitationStyle } from '../types';

interface Props {
  editor: Editor;
  citationStyle: CitationStyle;
  onStyleChange: (s: CitationStyle) => void;
  onExportBundle: () => void;
  onExportDocx: () => void;
  onExportPdf: () => void;
  onInsertMath: (kind: 'inline' | 'block') => void;
  onInsertImage: (files: File[]) => void;
  /** Present only when signed in to cloud sync. */
  onShare?: () => void;
  /** Other people editing right now (from collaboration awareness). */
  peers?: { name: string; color: string }[];
  /** Viewer role: all editing controls disabled. */
  readOnly?: boolean;
  saveState: 'saved' | 'saving';
  leftOpen: boolean;
  rightOpen: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
}

export function Toolbar({
  editor,
  citationStyle,
  onStyleChange,
  onExportBundle,
  onExportDocx,
  onExportPdf,
  onInsertMath,
  onInsertImage,
  onShare,
  peers = [],
  readOnly = false,
  saveState,
  leftOpen,
  rightOpen,
  onToggleLeft,
  onToggleRight,
}: Props) {
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!exportOpen) return;
    const close = (e: MouseEvent) => {
      if (!exportRef.current?.contains(e.target as Node)) setExportOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [exportOpen]);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      // The editor is recreated when the collaboration provider (dis)connects;
      // this selector can run once against the destroyed instance, where
      // isActive/can() would throw.
      if (!e || e.isDestroyed) {
        return {
          bold: false,
          italic: false,
          strike: false,
          code: false,
          h1: false,
          h2: false,
          h3: false,
          bulletList: false,
          orderedList: false,
          blockquote: false,
          canUndo: false,
          canRedo: false,
        };
      }
      return {
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        strike: e.isActive('strike'),
        code: e.isActive('code'),
        h1: e.isActive('heading', { level: 1 }),
        h2: e.isActive('heading', { level: 2 }),
        h3: e.isActive('heading', { level: 3 }),
        bulletList: e.isActive('bulletList'),
        orderedList: e.isActive('orderedList'),
        blockquote: e.isActive('blockquote'),
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
      };
    },
  });

  const btn = (
    active: boolean,
    title: string,
    icon: React.ReactNode,
    action: () => void,
    disabled = false,
  ) => (
    <button
      className={`tb-btn${active ? ' active' : ''}`}
      title={title}
      disabled={disabled || readOnly}
      onMouseDown={(e) => {
        e.preventDefault();
        action();
      }}
    >
      {icon}
    </button>
  );

  const chain = () => editor.chain().focus();

  return (
    <div className="toolbar">
      <div className="tb-group">
        {btn(
          false,
          leftOpen ? 'Hide documents' : 'Show documents',
          leftOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />,
          onToggleLeft,
        )}
      </div>
      <div className="tb-sep" />
      <div className="tb-group">
        {btn(false, 'Undo', <Undo2 size={15} />, () => chain().undo().run(), !state.canUndo)}
        {btn(false, 'Redo', <Redo2 size={15} />, () => chain().redo().run(), !state.canRedo)}
      </div>
      <div className="tb-sep" />
      <div className="tb-group">
        {btn(state.h1, 'Heading 1', <Heading1 size={15} />, () => chain().toggleHeading({ level: 1 }).run())}
        {btn(state.h2, 'Heading 2', <Heading2 size={15} />, () => chain().toggleHeading({ level: 2 }).run())}
        {btn(state.h3, 'Heading 3', <Heading3 size={15} />, () => chain().toggleHeading({ level: 3 }).run())}
      </div>
      <div className="tb-sep" />
      <div className="tb-group">
        {btn(state.bold, 'Bold', <Bold size={15} />, () => chain().toggleBold().run())}
        {btn(state.italic, 'Italic', <Italic size={15} />, () => chain().toggleItalic().run())}
        {btn(state.strike, 'Strikethrough', <Strikethrough size={15} />, () => chain().toggleStrike().run())}
        {btn(state.code, 'Inline code', <Code size={15} />, () => chain().toggleCode().run())}
      </div>
      <div className="tb-sep" />
      <div className="tb-group">
        {btn(state.bulletList, 'Bullet list', <List size={15} />, () => chain().toggleBulletList().run())}
        {btn(state.orderedList, 'Numbered list', <ListOrdered size={15} />, () => chain().toggleOrderedList().run())}
        {btn(state.blockquote, 'Blockquote', <TextQuote size={15} />, () => chain().toggleBlockquote().run())}
      </div>
      <div className="tb-sep" />
      <div className="tb-group">
        {btn(false, 'Inline equation', <Sigma size={15} />, () => onInsertMath('inline'))}
        {btn(false, 'Display equation', <SquareSigma size={15} />, () => onInsertMath('block'))}
        {btn(false, 'Insert image', <ImagePlus size={15} />, () => imageInputRef.current?.click())}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) onInsertImage(files);
            e.target.value = '';
          }}
        />
      </div>

      <div className="tb-spacer" />

      {readOnly && <span className="readonly-badge">View only</span>}

      {peers.length > 0 && (
        <div className="peer-stack" title={peers.map((p) => p.name).join(', ')}>
          {peers.slice(0, 4).map((p, i) => (
            <span key={i} className="peer-dot" style={{ background: p.color }}>
              {(p.name || '?')[0].toUpperCase()}
            </span>
          ))}
          {peers.length > 4 && <span className="peer-more">+{peers.length - 4}</span>}
        </div>
      )}

      {onShare && (
        <button className="btn btn-ghost share-btn" onClick={onShare}>
          <UserPlus size={15} /> Share
        </button>
      )}

      {!readOnly && (
        <span className={`save-badge ${saveState}`}>
          {saveState === 'saved' ? 'Saved' : 'Saving…'}
        </span>
      )}

      <select
        className="style-select"
        value={citationStyle}
        disabled={readOnly}
        onChange={(e) => onStyleChange(e.target.value as CitationStyle)}
        title="Citation style"
      >
        <option value="numeric">Numeric [1]</option>
        <option value="author-year">Author–year</option>
      </select>

      <div className="export-menu" ref={exportRef}>
        <button className="btn btn-ghost" onClick={() => setExportOpen((o) => !o)}>
          <Download size={15} /> Export <ChevronDown size={13} />
        </button>
        {exportOpen && (
          <div className="export-dropdown">
            <button
              onClick={() => {
                setExportOpen(false);
                onExportDocx();
              }}
            >
              <FileText size={14} /> Word (.docx)
            </button>
            <button
              onClick={() => {
                setExportOpen(false);
                onExportPdf();
              }}
            >
              <FileDown size={14} /> PDF (via print)
            </button>
            <button
              onClick={() => {
                setExportOpen(false);
                onExportBundle();
              }}
            >
              <FileJson size={14} /> SciDoc bundle (.json)
            </button>
          </div>
        )}
      </div>

      <div className="tb-sep" />
      <div className="tb-group">
        {btn(
          false,
          rightOpen ? 'Hide references' : 'Show references',
          rightOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />,
          onToggleRight,
        )}
      </div>
    </div>
  );
}
