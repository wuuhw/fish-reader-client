import { Chapter, SearchResult } from '../types';

/** Lightweight full-text search via indexOf scan. Returns up to `limit` hits. */
export function search(
  text: string,
  chapters: Chapter[],
  query: string,
  limit = 50
): SearchResult[] {
  const q = query.trim();
  const results: SearchResult[] = [];
  if (!q) return results;

  let from = 0;
  while (results.length < limit) {
    const idx = text.indexOf(q, from);
    if (idx === -1) break;
    const chapIdx = chapterIndexAt(chapters, idx);
    const chap = chapters[chapIdx];
    const ctxStart = Math.max(0, idx - 12);
    const ctxEnd = Math.min(text.length, idx + q.length + 18);
    const snippet = text
      .slice(ctxStart, ctxEnd)
      .replace(/\s+/g, ' ')
      .trim();
    results.push({
      chapterIndex: chapIdx,
      chapterTitle: chap ? chap.title : '正文',
      offset: idx,
      snippet,
    });
    from = idx + q.length;
  }
  return results;
}

function chapterIndexAt(chapters: Chapter[], offset: number): number {
  for (let i = chapters.length - 1; i >= 0; i--) {
    if (offset >= chapters[i].startOffset) return i;
  }
  return 0;
}
