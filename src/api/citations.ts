import type { Citation, CitationAuthor } from '../types';

const CROSSREF_API = 'https://api.crossref.org';
const EUTILS_API = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

function makeId(): string {
  return `cit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------- CrossRef ----------

interface CrossRefWork {
  DOI?: string;
  title?: string[];
  author?: { family?: string; given?: string; name?: string }[];
  issued?: { 'date-parts'?: number[][] };
  'container-title'?: string[];
  volume?: string;
  issue?: string;
  page?: string;
  URL?: string;
}

function fromCrossRef(work: CrossRefWork): Citation {
  const authors: CitationAuthor[] = (work.author ?? [])
    .map((a) => ({ family: a.family ?? a.name ?? '', given: a.given }))
    .filter((a) => a.family);
  const year = work.issued?.['date-parts']?.[0]?.[0];
  return {
    id: makeId(),
    source: 'crossref',
    doi: work.DOI,
    title: work.title?.[0] ?? 'Untitled',
    authors,
    year,
    journal: work['container-title']?.[0],
    volume: work.volume,
    issue: work.issue,
    pages: work.page,
    url: work.URL ?? (work.DOI ? `https://doi.org/${work.DOI}` : undefined),
    addedAt: Date.now(),
  };
}

export async function searchCrossRef(query: string, rows = 12): Promise<Citation[]> {
  const url = `${CROSSREF_API}/works?query.bibliographic=${encodeURIComponent(query)}&rows=${rows}&select=DOI,title,author,issued,container-title,volume,issue,page,URL`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CrossRef search failed (${res.status})`);
  const data = await res.json();
  return (data.message?.items ?? []).map(fromCrossRef);
}

export async function lookupDoi(doi: string): Promise<Citation> {
  const clean = doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  const res = await fetch(`${CROSSREF_API}/works/${encodeURIComponent(clean)}`);
  if (!res.ok) throw new Error(`DOI not found (${res.status})`);
  const data = await res.json();
  return fromCrossRef(data.message);
}

// ---------- PubMed (NCBI E-utilities) ----------

interface PubMedSummary {
  uid: string;
  title?: string;
  authors?: { name: string }[];
  pubdate?: string;
  fulljournalname?: string;
  source?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  elocationid?: string;
  articleids?: { idtype: string; value: string }[];
}

function fromPubMed(s: PubMedSummary): Citation {
  const authors: CitationAuthor[] = (s.authors ?? []).map((a) => {
    // PubMed names look like "Smith JA"
    const parts = a.name.split(' ');
    const given = parts.length > 1 ? parts.pop() : undefined;
    return { family: parts.join(' '), given };
  });
  const yearMatch = s.pubdate?.match(/\d{4}/);
  const doi = s.articleids?.find((i) => i.idtype === 'doi')?.value;
  return {
    id: makeId(),
    source: 'pubmed',
    pmid: s.uid,
    doi,
    title: (s.title ?? 'Untitled').replace(/\.$/, ''),
    authors,
    year: yearMatch ? Number(yearMatch[0]) : undefined,
    journal: s.fulljournalname ?? s.source,
    volume: s.volume,
    issue: s.issue,
    pages: s.pages,
    url: doi ? `https://doi.org/${doi}` : `https://pubmed.ncbi.nlm.nih.gov/${s.uid}/`,
    addedAt: Date.now(),
  };
}

async function fetchPubMedSummaries(ids: string[]): Promise<Citation[]> {
  if (ids.length === 0) return [];
  const res = await fetch(
    `${EUTILS_API}/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`,
  );
  if (!res.ok) throw new Error(`PubMed summary failed (${res.status})`);
  const data = await res.json();
  const result = data.result ?? {};
  return (result.uids ?? [])
    .map((uid: string) => result[uid])
    .filter(Boolean)
    .map(fromPubMed);
}

export async function searchPubMed(query: string, rows = 12): Promise<Citation[]> {
  const res = await fetch(
    `${EUTILS_API}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${rows}&sort=relevance&retmode=json`,
  );
  if (!res.ok) throw new Error(`PubMed search failed (${res.status})`);
  const data = await res.json();
  return fetchPubMedSummaries(data.esearchresult?.idlist ?? []);
}

export async function lookupPmid(pmid: string): Promise<Citation> {
  const results = await fetchPubMedSummaries([pmid.trim()]);
  if (results.length === 0) throw new Error('PMID not found');
  return results[0];
}

// ---------- Smart search entry point ----------

export type SearchSource = 'pubmed' | 'crossref';

const DOI_RE = /^(https?:\/\/(dx\.)?doi\.org\/)?10\.\d{4,9}\/\S+$/i;
const PMID_RE = /^\d{5,9}$/;

/** Searches by free text, or detects a pasted DOI / PMID and resolves it directly. */
export async function smartSearch(query: string, source: SearchSource): Promise<Citation[]> {
  const q = query.trim();
  if (DOI_RE.test(q)) return [await lookupDoi(q)];
  if (PMID_RE.test(q) && source === 'pubmed') return [await lookupPmid(q)];
  return source === 'pubmed' ? searchPubMed(q) : searchCrossRef(q);
}
