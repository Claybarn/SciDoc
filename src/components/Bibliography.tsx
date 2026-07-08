import { bibliographyEntry } from '../lib/format';
import type { Citation, CitationStyle } from '../types';

interface Props {
  citations: Record<string, Citation>;
  order: string[];
  style: CitationStyle;
}

export function Bibliography({ citations, order, style }: Props) {
  const cited = order.map((id) => citations[id]).filter(Boolean) as Citation[];
  if (cited.length === 0) return null;

  const entries =
    style === 'author-year'
      ? [...cited].sort((a, b) =>
          (a.authors[0]?.family ?? a.title).localeCompare(b.authors[0]?.family ?? b.title),
        )
      : cited;

  return (
    <section className="bibliography">
      <h2>References</h2>
      <ol className={style === 'author-year' ? 'bib-plain' : 'bib-numbered'}>
        {entries.map((c) => (
          <li key={c.id}>{bibliographyEntry(c, style)}</li>
        ))}
      </ol>
    </section>
  );
}
