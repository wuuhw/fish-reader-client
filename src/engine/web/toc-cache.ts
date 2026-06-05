// Local cache of a web novel's 目录 (chapter list), keyed by book id. Kept in
// localStorage (not the Rust state blob) since a long novel's TOC can be large.

export interface TocEntry {
  title: string;
  url: string;
}

const PREFIX = 'fishReader.webToc.';

export function getCachedToc(bookId: string): TocEntry[] | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + bookId);
    if (raw) return JSON.parse(raw) as TocEntry[];
  } catch {
    /* ignore */
  }
  return undefined;
}

export function setCachedToc(bookId: string, chapters: TocEntry[]): void {
  try {
    localStorage.setItem(PREFIX + bookId, JSON.stringify(chapters));
  } catch {
    /* ignore */
  }
}

export function clearCachedToc(bookId: string): void {
  try {
    localStorage.removeItem(PREFIX + bookId);
  } catch {
    /* ignore */
  }
}
