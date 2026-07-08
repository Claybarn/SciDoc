import type { JSONContent } from '@tiptap/core';

export interface CitationAuthor {
  family: string;
  given?: string;
}

export interface Citation {
  id: string;
  source: 'crossref' | 'pubmed' | 'manual';
  doi?: string;
  pmid?: string;
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
}
