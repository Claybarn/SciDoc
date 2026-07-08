import { useCallback, useState } from 'react';
import {
  BookMarked,
  CornerDownLeft,
  Loader2,
  Plus,
  Quote,
  Search,
  Trash2,
} from 'lucide-react';
import { smartSearch, type SearchSource } from '../api/citations';
import type { Citation } from '../types';

interface Props {
  citations: Record<string, Citation>;
  /** ids in order of first appearance in the text */
  order: string[];
  collapsed: boolean;
  onAdd: (c: Citation) => void;
  onAddAndInsert: (c: Citation) => void;
  onInsert: (id: string) => void;
  onRemove: (id: string) => void;
}

function CitationCard({
  citation,
  actions,
}: {
  citation: Citation;
  actions: React.ReactNode;
}) {
  const authors =
    citation.authors.length > 0
      ? citation.authors
          .slice(0, 3)
          .map((a) => a.family)
          .join(', ') + (citation.authors.length > 3 ? ', et al.' : '')
      : 'Unknown authors';
  return (
    <div className="cit-card">
      <div className="cit-card-body">
        <div className="cit-card-title">{citation.title}</div>
        <div className="cit-card-meta">
          {authors}
          {citation.year ? ` · ${citation.year}` : ''}
        </div>
        {citation.journal && <div className="cit-card-journal">{citation.journal}</div>}
      </div>
      <div className="cit-card-actions">{actions}</div>
    </div>
  );
}

export function CitationPanel({
  citations,
  order,
  collapsed,
  onAdd,
  onAddAndInsert,
  onInsert,
  onRemove,
}: Props) {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<SearchSource>('pubmed');
  const [results, setResults] = useState<Citation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    try {
      setResults(await smartSearch(q, source));
      setSearched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query, source]);

  // Bundle entries: cited ones first (in citation order), then uncited.
  const citedIds = order.filter((id) => citations[id]);
  const uncitedIds = Object.keys(citations).filter((id) => !order.includes(id));

  const isInBundle = (c: Citation) =>
    Object.values(citations).some(
      (b) => (c.doi && b.doi === c.doi) || (c.pmid && b.pmid === c.pmid),
    );

  return (
    <aside className={`cit-panel${collapsed ? ' collapsed' : ''}`}>
      <div className="cit-panel-inner">
      <section className="cit-search">
        <h3 className="panel-heading">
          <Search size={14} /> Find references
        </h3>
        <div className="seg-control">
          {(['pubmed', 'crossref'] as const).map((s) => (
            <button
              key={s}
              className={`seg${source === s ? ' active' : ''}`}
              onClick={() => setSource(s)}
            >
              {s === 'pubmed' ? 'PubMed' : 'CrossRef'}
            </button>
          ))}
        </div>
        <div className="search-row">
          <input
            className="search-input"
            placeholder="Title, author, DOI, or PMID…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
          />
          <button className="btn btn-primary search-go" onClick={runSearch} disabled={loading}>
            {loading ? <Loader2 size={15} className="spin" /> : <CornerDownLeft size={15} />}
          </button>
        </div>

        {error && <div className="cit-error">{error}</div>}

        <div className="cit-results">
          {searched && !loading && results.length === 0 && !error && (
            <p className="cit-hint">No results. Try different keywords.</p>
          )}
          {results.map((r) => {
            const dup = isInBundle(r);
            return (
              <CitationCard
                key={r.id}
                citation={r}
                actions={
                  dup ? (
                    <span className="cit-in-bundle">In bundle</span>
                  ) : (
                    <>
                      <button
                        className="icon-btn"
                        title="Add to bundle"
                        onClick={() => onAdd(r)}
                      >
                        <Plus size={14} />
                      </button>
                      <button
                        className="icon-btn accent"
                        title="Add and cite at cursor"
                        onClick={() => onAddAndInsert(r)}
                      >
                        <Quote size={14} />
                      </button>
                    </>
                  )
                }
              />
            );
          })}
        </div>
      </section>

      <section className="cit-bundle">
        <h3 className="panel-heading">
          <BookMarked size={14} /> Document bundle
          <span className="panel-count">{Object.keys(citations).length}</span>
        </h3>
        {Object.keys(citations).length === 0 && (
          <p className="cit-hint">
            References you add live inside this document — search above to get started.
          </p>
        )}
        {citedIds.map((id, i) => (
          <div key={id} className="bundle-row">
            <span className="bundle-num">{i + 1}</span>
            <CitationCard
              citation={citations[id]}
              actions={
                <>
                  <button className="icon-btn accent" title="Cite at cursor" onClick={() => onInsert(id)}>
                    <Quote size={14} />
                  </button>
                  <button className="icon-btn danger" title="Remove from bundle" onClick={() => onRemove(id)}>
                    <Trash2 size={14} />
                  </button>
                </>
              }
            />
          </div>
        ))}
        {uncitedIds.length > 0 && <div className="bundle-divider">Not yet cited</div>}
        {uncitedIds.map((id) => (
          <div key={id} className="bundle-row">
            <span className="bundle-num">–</span>
            <CitationCard
              citation={citations[id]}
              actions={
                <>
                  <button className="icon-btn accent" title="Cite at cursor" onClick={() => onInsert(id)}>
                    <Quote size={14} />
                  </button>
                  <button className="icon-btn danger" title="Remove from bundle" onClick={() => onRemove(id)}>
                    <Trash2 size={14} />
                  </button>
                </>
              }
            />
          </div>
        ))}
      </section>
      <div className="cit-panel-footer">Powered by PubMed (NCBI) &amp; CrossRef</div>
      </div>
    </aside>
  );
}
