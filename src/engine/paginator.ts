import { Chapter, PageMeta } from '../types';

const MAX_PARA = 600;
const TARGET_TRUNC = 300;

export interface Segment {
  text: string;
  meta: PageMeta;
  startOffset: number;
  endOffset: number; // where the next read should begin
  done: boolean; // true when there is nothing more to read
}

/**
 * Operates over the full book text + chapter list. A "segment" is one
 * displayed reading unit: either a chapter-title marker or a paragraph.
 */
export class Paginator {
  constructor(
    private readonly text: string,
    private readonly chapters: Chapter[],
    private charsPerPage: number,
    /** Keep merging consecutive short paragraphs until a segment reaches this many chars. */
    private mergeTarget: number = 50
  ) {}

  setCharsPerPage(n: number) {
    this.charsPerPage = Math.max(50, n);
  }

  setMergeTarget(n: number) {
    this.mergeTarget = Math.max(1, n);
  }

  get length() {
    return this.text.length;
  }

  private skipWhitespace(i: number): number {
    while (i < this.text.length && /\s/.test(this.text[i])) i++;
    return i;
  }

  private lineEnd(i: number): number {
    const nl = this.text.indexOf('\n', i);
    return nl === -1 ? this.text.length : nl;
  }

  /** Is offset `i` (already whitespace-skipped) the start of a chapter title line? */
  private chapterTitleAt(i: number): Chapter | undefined {
    return this.chapters.find((c) => c.title !== '卷首' && this.skipWhitespace(c.startOffset) === i);
  }

  /** Read the next segment starting at/after `offset`. */
  nextSegment(offset: number): Segment {
    const start = this.skipWhitespace(offset);
    if (start >= this.text.length) {
      return {
        text: '',
        meta: this.pageMetaFor(Math.min(offset, this.text.length - 1 < 0 ? 0 : this.text.length - 1)),
        startOffset: start,
        endOffset: this.text.length,
        done: true,
      };
    }

    // Chapter title? (start is already the first non-whitespace of the title line)
    const chap = this.chapterTitleAt(start);
    if (chap) {
      const end = this.lineEnd(start);
      const titleText = this.text.slice(start, end).trim();
      return {
        text: titleText,
        meta: { ...this.pageMetaFor(start), atChapterStart: true },
        startOffset: start,
        endOffset: Math.max(end, start + 1),
        done: false,
      };
    }

    // Accumulate a paragraph: merge consecutive short paragraphs until the block
    // reaches mergeTarget chars (keeps internal line breaks for readability).
    let end = this.lineEnd(start);
    while (end < this.text.length) {
      const trimmedLen = this.text.slice(start, end).trim().length;
      if (trimmedLen >= this.mergeTarget) break;
      const after = this.skipWhitespace(end);
      if (after >= this.text.length) {
        end = this.text.length;
        break;
      }
      if (this.chapterTitleAt(after)) break; // don't merge across a chapter title
      const nextEnd = this.lineEnd(after);
      if (this.text.slice(start, nextEnd).trim().length > MAX_PARA) break;
      end = nextEnd;
    }

    let text = this.text.slice(start, end);

    // Truncate very long paragraphs at a sentence boundary near TARGET_TRUNC.
    if (text.length > MAX_PARA) {
      const cut = this.findSentenceBoundary(start, start + TARGET_TRUNC);
      end = cut;
      text = this.text.slice(start, end);
    }

    return {
      text: text.trim(),
      meta: this.pageMetaFor(start),
      startOffset: start,
      endOffset: end,
      done: false,
    };
  }

  private findSentenceBoundary(from: number, around: number): number {
    const punct = '。！？!?…”』」';
    const lo = Math.max(from + TARGET_TRUNC - 60, from + 1);
    const hi = Math.min(around + 60, this.text.length);
    for (let i = hi - 1; i >= lo; i--) {
      if (punct.includes(this.text[i])) return i + 1;
    }
    return Math.min(around, this.text.length);
  }

  chapterStartOffset(index: number): number {
    const c = this.chapters[index];
    return c ? c.startOffset : 0;
  }

  pageMetaFor(offset: number): PageMeta {
    const idx = this.chapterIndexAt(offset);
    const chap = this.chapters[idx] || { title: '正文', startOffset: 0, endOffset: this.text.length, index: 0 };
    const chapLen = Math.max(1, chap.endOffset - chap.startOffset);
    const pagesInChapter = Math.max(1, Math.ceil(chapLen / this.charsPerPage));
    const pageInChapter = Math.min(
      pagesInChapter,
      Math.floor((offset - chap.startOffset) / this.charsPerPage) + 1
    );
    return {
      chapterIndex: idx,
      chapterTitle: chap.title,
      pageInChapter: Math.max(1, pageInChapter),
      pagesInChapter,
      charOffset: offset,
      atChapterStart: false,
    };
  }

  private chapterIndexAt(offset: number): number {
    for (let i = this.chapters.length - 1; i >= 0; i--) {
      if (offset >= this.chapters[i].startOffset) return i;
    }
    return 0;
  }

  /** Restore context: a few segments ending at/around `offset`, for boss-mode exit. */
  contextAround(offset: number, count: number): { text: string; meta: PageMeta }[] {
    const idx = this.chapterIndexAt(offset);
    let cursor = this.chapters[idx]?.startOffset ?? 0;
    const segs: { text: string; meta: PageMeta }[] = [];
    let guard = 0;
    while (cursor < offset && guard++ < 2000) {
      const seg = this.nextSegment(cursor);
      if (seg.done) break;
      segs.push({ text: seg.text, meta: seg.meta });
      cursor = seg.endOffset;
    }
    return segs.slice(-count);
  }
}
