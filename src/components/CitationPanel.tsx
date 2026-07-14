import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookMarked,
  Check,
  ChevronDown,
  CornerDownLeft,
  Info,
  KeyRound,
  Loader2,
  Plus,
  Quote,
  Search,
  Trash2,
} from 'lucide-react';
import { smartSearch, type SearchSource } from '../api/citations';
import type { Citation, CitationSource } from '../types';

interface SourceOption {
  value: SearchSource;
  label: string;
  desc: string;
  placeholder: string;
}

const SOURCE_OPTIONS: SourceOption[] = [
  { value: 'pubmed', label: 'PubMed', desc: 'Biomedical literature', placeholder: 'Title, author, DOI, or PMID…' },
  { value: 'crossref', label: 'CrossRef', desc: 'Cross-discipline journals', placeholder: 'Title, author, or DOI…' },
  { value: 'preprint', label: 'Preprints', desc: 'bioRxiv, medRxiv & more', placeholder: 'Title, author, or DOI…' },
  { value: 'arxiv', label: 'arXiv', desc: 'Physics, math, CS', placeholder: 'Title, author, or arXiv ID…' },
  { value: 'ads', label: 'NASA ADS', desc: 'Astrophysics', placeholder: 'Title, author, or bibcode…' },
];

const SOURCE_BADGE: Record<CitationSource, string> = {
  pubmed: 'PubMed',
  crossref: 'CrossRef',
  preprint: 'Preprint',
  arxiv: 'arXiv',
  ads: 'ADS',
  manual: 'Manual',
};

const ADS_TOKEN_KEY = 'scidoc:ads-token';

interface Props {
  citations: Record<string, Citation>;
  /** ids in order of first appearance in the text */
  order: string[];
  collapsed: boolean;
  /** Viewer role: browse the bundle but don't modify it or the text. */
  readOnly?: boolean;
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
          <span className={`source-badge source-${citation.source}`}>
            {SOURCE_BADGE[citation.source]}
          </span>
          {authors}
          {citation.year ? ` · ${citation.year}` : ''}
        </div>
        {citation.journal && (
          <div className="cit-card-journal">
            {citation.journal}
            {(citation.source === 'preprint' || citation.source === 'arxiv') && (
              <span className="preprint-tag">preprint</span>
            )}
          </div>
        )}
      </div>
      <div className="cit-card-actions">{actions}</div>
    </div>
  );
}

export function CitationPanel({
  citations,
  order,
  collapsed,
  readOnly = false,
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
  const [adsToken, setAdsToken] = useState(() => localStorage.getItem(ADS_TOKEN_KEY) ?? '');
  const [adsTokenOpen, setAdsTokenOpen] = useState(false);
  const [adsInfoOpen, setAdsInfoOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const sourceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sourceOpen) return;
    const close = (e: MouseEvent) => {
      if (!sourceRef.current?.contains(e.target as Node)) setSourceOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [sourceOpen]);

  const saveAdsToken = useCallback((token: string) => {
    setAdsToken(token);
    if (token) localStorage.setItem(ADS_TOKEN_KEY, token);
    else localStorage.removeItem(ADS_TOKEN_KEY);
  }, []);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    // Guide first-time ADS users instead of failing with a terse error.
    if (source === 'ads' && !adsToken) {
      setError(null);
      setAdsInfoOpen(true);
      setAdsTokenOpen(true);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setResults(await smartSearch(q, source, { adsToken }));
      setSearched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query, source, adsToken]);

  const placeholder =
    SOURCE_OPTIONS.find((o) => o.value === source)?.placeholder ?? 'Search…';

  // Bundle entries: cited ones first (in citation order), then uncited.
  const citedIds = order.filter((id) => citations[id]);
  const uncitedIds = Object.keys(citations).filter((id) => !order.includes(id));

  const isInBundle = (c: Citation) =>
    Object.values(citations).some(
      (b) =>
        (c.doi && b.doi === c.doi) ||
        (c.pmid && b.pmid === c.pmid) ||
        (c.arxivId && b.arxivId === c.arxivId) ||
        (c.bibcode && b.bibcode === c.bibcode),
    );

  return (
    <aside className={`cit-panel${collapsed ? ' collapsed' : ''}`}>
      <div className="cit-panel-inner">
      <section className="cit-search">
        <h3 className="panel-heading">
          <Search size={14} /> Find references
        </h3>
        <div className="source-row">
          <div className="source-dropdown" ref={sourceRef}>
            <button
              className={`source-trigger${sourceOpen ? ' open' : ''}`}
              onClick={() => setSourceOpen((o) => !o)}
            >
              <span className={`source-dot source-${source}`} />
              <span className="source-trigger-label">
                {SOURCE_OPTIONS.find((o) => o.value === source)?.label}
              </span>
              <ChevronDown size={14} className="source-chevron" />
            </button>
            {sourceOpen && (
              <div className="source-menu" role="listbox">
                {SOURCE_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    role="option"
                    aria-selected={o.value === source}
                    className={`source-item${o.value === source ? ' active' : ''}`}
                    onClick={() => {
                      setSource(o.value);
                      setSourceOpen(false);
                    }}
                  >
                    <span className={`source-dot source-${o.value}`} />
                    <span className="source-item-text">
                      <span className="source-item-label">{o.label}</span>
                      <span className="source-item-desc">{o.desc}</span>
                    </span>
                    {o.value === source && <Check size={15} className="source-check" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          {source === 'ads' && (
            <>
              <button
                className={`icon-btn ads-info-btn${adsInfoOpen ? ' active' : ''}`}
                title="What is an ADS token?"
                onClick={() => setAdsInfoOpen((o) => !o)}
              >
                <Info size={14} />
              </button>
              <button
                className={`icon-btn ads-key-btn${adsToken ? ' has-token' : ''}`}
                title={adsToken ? 'ADS token saved — edit' : 'Add ADS API token'}
                onClick={() => setAdsTokenOpen((o) => !o)}
              >
                <KeyRound size={14} />
              </button>
            </>
          )}
        </div>

        {source === 'ads' && adsInfoOpen && (
          <div className="ads-info-box">
            <p className="ads-info-lead">
              <strong>NASA ADS</strong> is the reference database for astronomy and astrophysics.
              It asks each person to use a personal <em>API token</em> — a
              free key that lets the app search on your behalf.
            </p>
            <ol className="ads-info-steps">
              <li>
                Create a free account at{' '}
                <a href="https://ui.adsabs.harvard.edu/user/account/register" target="_blank" rel="noreferrer">
                  ADS
                </a>{' '}
                (or sign in).
              </li>
              <li>
                Open{' '}
                <a href="https://ui.adsabs.harvard.edu/user/settings/token" target="_blank" rel="noreferrer">
                  Settings → API Token
                </a>{' '}
                and copy the token it shows.
              </li>
              <li>Paste it into the key field here — it stays on your device and is never shared.</li>
            </ol>
            <button
              className="btn btn-primary ads-info-cta"
              onClick={() => {
                setAdsTokenOpen(true);
                setAdsInfoOpen(false);
              }}
            >
              Enter my token
            </button>
          </div>
        )}

        {source === 'ads' && adsTokenOpen && (
          <div className="ads-token-box">
            <input
              className="search-input"
              type="password"
              placeholder="Paste ADS API token…"
              value={adsToken}
              onChange={(e) => saveAdsToken(e.target.value)}
            />
            <button className="ads-token-help-link" onClick={() => setAdsInfoOpen(true)}>
              What is this? How do I get one?
            </button>
          </div>
        )}

        <div className="search-row">
          <input
            className="search-input"
            placeholder={placeholder}
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
                  ) : readOnly ? null : (
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
                readOnly ? null : (
                  <>
                    <button className="icon-btn accent" title="Cite at cursor" onClick={() => onInsert(id)}>
                      <Quote size={14} />
                    </button>
                    <button className="icon-btn danger" title="Remove from bundle" onClick={() => onRemove(id)}>
                      <Trash2 size={14} />
                    </button>
                  </>
                )
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
                readOnly ? null : (
                  <>
                    <button className="icon-btn accent" title="Cite at cursor" onClick={() => onInsert(id)}>
                      <Quote size={14} />
                    </button>
                    <button className="icon-btn danger" title="Remove from bundle" onClick={() => onRemove(id)}>
                      <Trash2 size={14} />
                    </button>
                  </>
                )
              }
            />
          </div>
        ))}
      </section>
      <div className="cit-panel-footer">PubMed · CrossRef · Europe PMC · arXiv · NASA ADS</div>
      </div>
    </aside>
  );
}
