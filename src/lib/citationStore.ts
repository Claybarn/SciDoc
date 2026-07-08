import type { Citation, CitationStyle } from '../types';

/**
 * Tiny external store bridging the document's citation bundle to the
 * TipTap node views (which live outside normal React data flow).
 */
export class CitationStore {
  private citations: Record<string, Citation> = {};
  private order: string[] = [];
  private style: CitationStyle = 'numeric';
  private listeners = new Set<() => void>();
  version = 0;

  set(citations: Record<string, Citation>, order: string[], style: CitationStyle) {
    this.citations = citations;
    this.order = order;
    this.style = style;
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  getCitation = (id: string): Citation | undefined => this.citations[id];

  getNumber = (id: string): number | undefined => {
    const idx = this.order.indexOf(id);
    return idx === -1 ? undefined : idx + 1;
  };

  getStyle = (): CitationStyle => this.style;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
}
