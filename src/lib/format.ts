import type { Citation, CitationAuthor, CitationStyle } from '../types';

function initials(given?: string): string {
  if (!given) return '';
  return given
    .split(/[\s.-]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase())
    .join('');
}

function vancouverAuthors(authors: CitationAuthor[]): string {
  if (authors.length === 0) return '';
  const shown = authors.slice(0, 6).map((a) => `${a.family} ${initials(a.given)}`.trim());
  return authors.length > 6 ? `${shown.join(', ')}, et al` : shown.join(', ');
}

function apaAuthors(authors: CitationAuthor[]): string {
  if (authors.length === 0) return '';
  const fmt = (a: CitationAuthor) =>
    a.given ? `${a.family}, ${initials(a.given).split('').join('. ')}.` : a.family;
  if (authors.length === 1) return fmt(authors[0]);
  if (authors.length <= 7) {
    const rest = authors.slice(0, -1).map(fmt).join(', ');
    return `${rest}, & ${fmt(authors[authors.length - 1])}`;
  }
  return `${authors.slice(0, 6).map(fmt).join(', ')}, … ${fmt(authors[authors.length - 1])}`;
}

/** Short label shown inside the editor, e.g. "Smith et al., 2021". */
export function inTextLabel(c: Citation): string {
  const year = c.year ?? 'n.d.';
  if (c.authors.length === 0) return `${c.title.slice(0, 24)}…, ${year}`;
  if (c.authors.length === 1) return `${c.authors[0].family}, ${year}`;
  if (c.authors.length === 2) return `${c.authors[0].family} & ${c.authors[1].family}, ${year}`;
  return `${c.authors[0].family} et al., ${year}`;
}

/** Full bibliography entry for one citation. */
export function bibliographyEntry(c: Citation, style: CitationStyle): string {
  const parts: string[] = [];
  if (style === 'numeric') {
    // Vancouver-ish
    if (c.authors.length) parts.push(`${vancouverAuthors(c.authors)}.`);
    parts.push(`${c.title}.`);
    if (c.journal) {
      let loc = c.journal;
      if (c.year) loc += ` ${c.year}`;
      if (c.volume) loc += `;${c.volume}`;
      if (c.issue) loc += `(${c.issue})`;
      if (c.pages) loc += `:${c.pages}`;
      parts.push(`${loc}.`);
    } else if (c.year) {
      parts.push(`${c.year}.`);
    }
  } else {
    // APA-ish
    if (c.authors.length) parts.push(apaAuthors(c.authors));
    parts.push(`(${c.year ?? 'n.d.'}).`);
    parts.push(`${c.title}.`);
    if (c.journal) {
      let loc = c.journal;
      if (c.volume) loc += `, ${c.volume}`;
      if (c.issue) loc += `(${c.issue})`;
      if (c.pages) loc += `, ${c.pages}`;
      parts.push(`${loc}.`);
    }
  }
  if (c.doi) parts.push(`https://doi.org/${c.doi}`);
  else if (c.url) parts.push(c.url);
  return parts.join(' ');
}

/**
 * Walks TipTap JSON content and returns citation ids in order of first
 * appearance — this drives numbering and bibliography order.
 */
export function citationOrderFromContent(content: unknown): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string; attrs?: { citationId?: string }; content?: unknown[] };
    if (n.type === 'citation' && n.attrs?.citationId && !seen.has(n.attrs.citationId)) {
      seen.add(n.attrs.citationId);
      order.push(n.attrs.citationId);
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(content);
  return order;
}
