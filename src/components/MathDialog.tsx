import { useEffect, useMemo, useRef, useState } from 'react';
import katex from 'katex';
import { Trash2, X } from 'lucide-react';

export interface MathDialogState {
  kind: 'inline' | 'block';
  /** Position of an existing node being edited; undefined = inserting new */
  pos?: number;
  latex: string;
}

interface Props {
  state: MathDialogState;
  onSave: (latex: string) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function MathDialog({ state, onSave, onDelete, onClose }: Props) {
  const [latex, setLatex] = useState(state.latex);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const editing = state.pos !== undefined;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const preview = useMemo(() => {
    if (!latex.trim()) return { html: '', error: null };
    try {
      return {
        html: katex.renderToString(latex, {
          displayMode: state.kind === 'block',
          throwOnError: true,
        }),
        error: null,
      };
    } catch (e) {
      return { html: '', error: e instanceof Error ? e.message.replace(/^KaTeX parse error: /, '') : 'Invalid LaTeX' };
    }
  }, [latex, state.kind]);

  const save = () => {
    if (latex.trim() && !preview.error) onSave(latex.trim());
  };

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>
            {editing ? 'Edit' : 'Insert'} {state.kind === 'block' ? 'display' : 'inline'} equation
          </h3>
          <button className="icon-btn" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>

        <textarea
          ref={inputRef}
          className="math-input"
          rows={state.kind === 'block' ? 4 : 2}
          placeholder={state.kind === 'block' ? '\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}' : 'E = mc^2'}
          value={latex}
          onChange={(e) => setLatex(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
            if (e.key === 'Escape') onClose();
          }}
          spellCheck={false}
        />

        <div className={`math-preview${preview.error ? ' has-error' : ''}`}>
          {preview.error ? (
            <span className="math-preview-error">{preview.error}</span>
          ) : preview.html ? (
            <span dangerouslySetInnerHTML={{ __html: preview.html }} />
          ) : (
            <span className="math-preview-hint">LaTeX preview appears here</span>
          )}
        </div>

        <div className="modal-footer">
          {editing && (
            <button className="btn btn-ghost modal-delete" onClick={onDelete}>
              <Trash2 size={14} /> Remove
            </button>
          )}
          <div className="modal-footer-right">
            <button className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={save}
              disabled={!latex.trim() || !!preview.error}
            >
              {editing ? 'Update' : 'Insert'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
