import type { Citation, CitationAuthor } from '../types';

const CROSSREF_API = 'https://api.crossref.org';
const EUTILS_API = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const EUROPEPMC_API = 'https://www.ebi.ac.uk/europepmc/webservices/rest';
// arXiv and ADS lack CORS, so we reach them through same-origin proxy paths
// (Vite dev server proxy locally, Cloudflare Worker in production).
const ARXIV_PROXY = '/api/arxiv';
const ADS_PROXY = '/api/ads';

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

// ---------- Preprints (Europe PMC) ----------

interface EpmcResult {
  id?: string;
  source?: string;
  doi?: string;
  title?: string;
  authorList?: { author?: { lastName?: string; firstName?: string; initials?: string; fullName?: string }[] };
  authorString?: string;
  pubYear?: string;
  bookOrReportDetails?: { publisher?: string };
}

function fromEpmc(r: EpmcResult): Citation {
  const server = r.bookOrReportDetails?.publisher;
  let authors: CitationAuthor[] = (r.authorList?.author ?? []).map((a) => ({
    family: a.lastName ?? a.fullName ?? '',
    given: a.firstName ?? a.initials,
  }));
  if (authors.length === 0 && r.authorString) {
    authors = r.authorString
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)
      .map((n) => {
        const parts = n.split(' ');
        const given = parts.length > 1 ? parts.pop() : undefined;
        return { family: parts.join(' '), given };
      });
  }
  return {
    id: makeId(),
    source: 'preprint',
    doi: r.doi,
    server,
    title: (r.title ?? 'Untitled').replace(/\.$/, ''),
    authors: authors.filter((a) => a.family),
    year: r.pubYear ? Number(r.pubYear) : undefined,
    journal: server,
    url: r.doi ? `https://doi.org/${r.doi}` : undefined,
    addedAt: Date.now(),
  };
}

const PREPRINT_SERVERS = ['bioRxiv', 'medRxiv', 'Research Square', 'arXiv', 'ChemRxiv'];

export async function searchPreprints(query: string, rows = 12): Promise<Citation[]> {
  const servers = PREPRINT_SERVERS.map((s) => `PUBLISHER:"${s}"`).join(' OR ');
  const term = `(${query}) AND SRC:PPR AND (${servers})`;
  const url = `${EUROPEPMC_API}/search?query=${encodeURIComponent(term)}&format=json&pageSize=${rows}&resultType=core&sort=P_PDATE_D desc`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Preprint search failed (${res.status})`);
  const data = await res.json();
  return (data.resultList?.result ?? []).map(fromEpmc);
}

// ---------- arXiv (Atom XML via proxy) ----------

function fromArxivEntry(entry: Element): Citation {
  const text = (tag: string) => entry.getElementsByTagName(tag)[0]?.textContent?.trim() ?? '';
  const idUrl = text('id');
  const arxivId = idUrl.replace(/^https?:\/\/arxiv\.org\/abs\//, '');
  const authors: CitationAuthor[] = Array.from(entry.getElementsByTagName('author')).map((a) => {
    const name = a.getElementsByTagName('name')[0]?.textContent?.trim() ?? '';
    const parts = name.split(' ');
    const family = parts.pop() ?? name;
    return { family, given: parts.join(' ') || undefined };
  });
  const published = text('published');
  const doi = entry.getElementsByTagName('arxiv:doi')[0]?.textContent?.trim();
  return {
    id: makeId(),
    source: 'arxiv',
    arxivId,
    doi: doi || undefined,
    server: 'arXiv',
    title: text('title').replace(/\s+/g, ' '),
    authors,
    year: published ? Number(published.slice(0, 4)) : undefined,
    journal: 'arXiv',
    url: idUrl || `https://arxiv.org/abs/${arxivId}`,
    addedAt: Date.now(),
  };
}

export async function searchArxiv(query: string, rows = 12): Promise<Citation[]> {
  const url = `${ARXIV_PROXY}?search_query=${encodeURIComponent(`all:${query}`)}&start=0&max_results=${rows}&sortBy=relevance`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`arXiv search failed (${res.status})`);
  const xml = await res.text();
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return Array.from(doc.getElementsByTagName('entry')).map(fromArxivEntry);
}

// ---------- ADS (NASA Astrophysics Data System, needs token) ----------

interface AdsDoc {
  bibcode?: string;
  title?: string[];
  author?: string[];
  year?: string;
  pub?: string;
  volume?: string;
  page?: string[];
  doi?: string[];
}

function fromAds(d: AdsDoc): Citation {
  const authors: CitationAuthor[] = (d.author ?? []).map((name) => {
    // ADS format: "Last, First M."
    const [family, rest] = name.split(',').map((s) => s.trim());
    return { family: family ?? name, given: rest || undefined };
  });
  return {
    id: makeId(),
    source: 'ads',
    bibcode: d.bibcode,
    doi: d.doi?.[0],
    title: d.title?.[0] ?? 'Untitled',
    authors,
    year: d.year ? Number(d.year) : undefined,
    journal: d.pub,
    volume: d.volume,
    pages: d.page?.[0],
    url: d.bibcode ? `https://ui.adsabs.harvard.edu/abs/${encodeURIComponent(d.bibcode)}` : undefined,
    addedAt: Date.now(),
  };
}

export async function searchAds(query: string, token: string, rows = 12): Promise<Citation[]> {
  if (!token) throw new Error('Add your ADS API token to search NASA ADS');
  const fields = 'bibcode,title,author,year,pub,volume,page,doi';
  const url = `${ADS_PROXY}?q=${encodeURIComponent(query)}&rows=${rows}&fl=${fields}&sort=${encodeURIComponent('score desc')}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new Error('ADS rejected the token — check it and try again');
  if (!res.ok) throw new Error(`ADS search failed (${res.status})`);
  const data = await res.json();
  return (data.response?.docs ?? []).map(fromAds);
}

// ---------- Smart search entry point ----------

export type SearchSource = 'pubmed' | 'crossref' | 'preprint' | 'arxiv' | 'ads';

const DOI_RE = /^(https?:\/\/(dx\.)?doi\.org\/)?10\.\d{4,9}\/\S+$/i;
const PMID_RE = /^\d{5,9}$/;
const ARXIV_ID_RE = /^(arxiv:)?\d{4}\.\d{4,5}(v\d+)?$/i;

export interface SearchOptions {
  adsToken?: string;
}

/** Searches by free text, or detects a pasted DOI / PMID / arXiv id and resolves it directly. */
export async function smartSearch(
  query: string,
  source: SearchSource,
  opts: SearchOptions = {},
): Promise<Citation[]> {
  const q = query.trim();
  if (DOI_RE.test(q) && source !== 'ads') return [await lookupDoi(q)];
  if (PMID_RE.test(q) && source === 'pubmed') return [await lookupPmid(q)];
  if (ARXIV_ID_RE.test(q) && source === 'arxiv') {
    const id = q.replace(/^arxiv:/i, '');
    const res = await fetch(`${ARXIV_PROXY}?id_list=${encodeURIComponent(id)}&max_results=1`);
    if (!res.ok) throw new Error(`arXiv lookup failed (${res.status})`);
    const doc = new DOMParser().parseFromString(await res.text(), 'application/xml');
    return Array.from(doc.getElementsByTagName('entry')).map(fromArxivEntry);
  }
  switch (source) {
    case 'pubmed':
      return searchPubMed(q);
    case 'crossref':
      return searchCrossRef(q);
    case 'preprint':
      return searchPreprints(q);
    case 'arxiv':
      return searchArxiv(q);
    case 'ads':
      return searchAds(q, opts.adsToken ?? '');
  }
}
