import { useRef } from 'react';
import { FilePlus2, FlaskConical, Trash2, Upload } from 'lucide-react';
import type { DocumentMeta } from '../types';

interface Props {
  docs: DocumentMeta[];
  activeId: string | null;
  collapsed: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onImport: (file: File) => void;
  /** Rendered above the footer — used for the account/sync widget. */
  children?: React.ReactNode;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function Sidebar({
  docs,
  activeId,
  collapsed,
  onSelect,
  onCreate,
  onDelete,
  onImport,
  children,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-inner">
      <div className="sidebar-brand">
        <FlaskConical size={20} />
        <span>SciDoc</span>
      </div>

      <div className="sidebar-actions">
        <button className="btn btn-primary" onClick={onCreate}>
          <FilePlus2 size={15} /> New document
        </button>
        <button
          className="btn btn-ghost"
          title="Import .scidoc.json bundle"
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={15} /> Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImport(f);
            e.target.value = '';
          }}
        />
      </div>

      <div className="sidebar-list">
        {docs.length === 0 && <p className="sidebar-empty">No documents yet.</p>}
        {docs.map((d) => (
          <div
            key={d.id}
            className={`doc-item${d.id === activeId ? ' active' : ''}`}
            onClick={() => onSelect(d.id)}
          >
            <div className="doc-item-main">
              <span className="doc-item-title">{d.title || 'Untitled document'}</span>
              <span className="doc-item-meta">
                {relativeTime(d.updatedAt)} · {d.citationCount} ref{d.citationCount === 1 ? '' : 's'}
              </span>
            </div>
            <button
              className="icon-btn doc-item-delete"
              title="Delete document"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete “${d.title}”? This cannot be undone.`)) onDelete(d.id);
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      {children}

      <div className="sidebar-footer">
        Each document bundles its own references.
        <br />
        No library files. Ever.
      </div>
      </div>
    </aside>
  );
}
