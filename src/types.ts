import type { JSONContent } from '@tiptap/core';

export interface CitationAuthor {
  family: string;
  given?: string;
}

export type CitationSource =
  | 'crossref'
  | 'pubmed'
  | 'preprint'
  | 'arxiv'
  | 'ads'
  | 'manual';

export interface Citation {
  id: string;
  source: CitationSource;
  doi?: string;
  pmid?: string;
  arxivId?: string;
  bibcode?: string;
  /** Preprint server or repository name, e.g. "bioRxiv", "arXiv". */
  server?: string;
  title: string;
  authors: CitationAuthor[];
  year?: number;
  journal?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  url?: string;
  addedAt: number;
}

export type CitationStyle = 'numeric' | 'author-year';

/**
 * A fully self-contained document: prose + its own citation bundle.
 * No external library files — this object is the whole document.
 */
export interface SciDocument {
  id: string;
  title: string;
  /** TipTap JSON content */
  content: JSONContent;
  citations: Record<string, Citation>;
  citationStyle: CitationStyle;
  createdAt: number;
  updatedAt: number;
}

export interface DocumentMeta {
  id: string;
  title: string;
  updatedAt: number;
  citationCount: number;
  /**
   * Cloud owner (auth user id), when known. localStorage is shared by every
   * account used in this browser, so this distinguishes another account's
   * documents from our own and from local-only ones.
   */
  ownerId?: string;
}
