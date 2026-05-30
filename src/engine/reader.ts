import { Chapter, BookMeta, SearchResult } from '../types';
import { splitChapters, subdivideChapters, deriveTitle } from './parser';
import { Paginator, Segment } from './paginator';
import { search as fullTextSearch } from './search';
import { bookId } from './state';

/** A loaded book held in memory with reading cursor + navigation history. */
export class ReaderEngine {
  readonly meta: BookMeta;
  readonly chapters: Chapter[];
  private readonly paginator: Paginator;
  private readonly text: string;

  /** Offset to read the next chapter from. */
  private cursor = 0;
  /** Index (into this.chapters) of the chapter currently shown; -1 = none yet. */
  private curIndex = -1;

  constructor(
    filePath: string,
    fileBaseName: string,
    text: string,
    opts: {
      charsPerPage: number;
      chapterRegex: string;
      maxChapterChars: number;
      mergeTarget: number;
      /** Pre-split chapters (EPUB/FB2) — skips the chapter-title regex. */
      prebuiltChapters?: Chapter[];
      /** Explicit book title (EPUB/FB2 metadata) overrides the derived one. */
      bookTitle?: string;
    }
  ) {
    this.text = text;
    const base = opts.prebuiltChapters ?? splitChapters(text, opts.chapterRegex);
    this.chapters = subdivideChapters(text, base, opts.maxChapterChars);
    this.paginator = new Paginator(text, this.chapters, opts.charsPerPage, opts.mergeTarget);
    this.meta = {
      id: bookId(filePath),
      path: filePath,
      title: opts.bookTitle?.trim() || deriveTitle(fileBaseName, text),
      totalChapters: this.chapters.length,
      totalChars: text.length,
    };
  }

  setCharsPerPage(n: number) {
    this.paginator.setCharsPerPage(n);
  }

  /** Set cursor to a saved position (start of next chapter to show). */
  restorePosition(offset: number) {
    this.cursor = Math.min(Math.max(0, offset), this.text.length);
    this.curIndex = -1;
  }

  private chapterIndexAtOffset(offset: number): number {
    return this.paginator.pageMetaFor(Math.max(0, Math.min(offset, this.text.length - 1))).chapterIndex;
  }

  get position() {
    return this.cursor;
  }

  /** Collect every segment from `startOffset` to the end of its chapter. */
  private collectChapter(startOffset: number): { segments: Segment[]; nextCursor: number } {
    const idx = this.paginator.pageMetaFor(startOffset).chapterIndex;
    const chapEnd = this.chapters[idx]?.endOffset ?? this.text.length;
    const segments: Segment[] = [];
    let c = startOffset;
    let guard = 0;
    while (c < chapEnd && guard++ < 5000) {
      const seg = this.paginator.nextSegment(c);
      if (seg.done || seg.startOffset >= chapEnd) break;
      segments.push(seg);
      c = seg.endOffset;
    }
    return { segments, nextCursor: chapEnd };
  }

  /** A chapter is "real" only if it has body text, not just a title line. */
  private hasBody(segments: Segment[]): boolean {
    return segments.some((s) => !s.meta.atChapterStart);
  }

  /**
   * From `from`, find the next chapter that actually has body text, skipping
   * title-only / empty chapters.
   */
  private collectNonEmptyFrom(from: number): { segments: Segment[]; start: number; nextCursor: number } {
    let c = from;
    let guard = 0;
    while (c < this.text.length && guard++ < 2000) {
      const { segments, nextCursor } = this.collectChapter(c);
      const next = nextCursor > c ? nextCursor : this.text.length;
      if (segments.length && this.hasBody(segments)) {
        return { segments, start: c, nextCursor: next };
      }
      c = next;
    }
    return { segments: [], start: from, nextCursor: this.text.length };
  }

  /** Read the next chapter with content; advance to the chapter after it. */
  nextChapter(): { segments: Segment[]; done: boolean } {
    if (this.cursor >= this.text.length) return { segments: [], done: true };
    const { segments, start, nextCursor } = this.collectNonEmptyFrom(this.cursor);
    if (!segments.length) {
      this.cursor = this.text.length;
      return { segments: [], done: true };
    }
    this.curIndex = this.chapterIndexAtOffset(start);
    this.cursor = nextCursor;
    return { segments, done: false };
  }

  /** Step back exactly one chapter (skipping empty/title-only ones). */
  prevChapter(): { segments: Segment[]; done: boolean } {
    const cur = this.curIndex >= 0 ? this.curIndex : this.chapterIndexAtOffset(this.cursor - 1);

    for (let j = cur - 1; j >= 0; j--) {
      const start = this.chapters[j].startOffset;
      const segs = this.collectChapter(start).segments;
      if (this.hasBody(segs)) {
        this.curIndex = j;
        this.cursor = this.chapters[j].endOffset;
        return { segments: segs, done: false };
      }
    }

    const first = this.collectNonEmptyFrom(0);
    if (first.segments.length) {
      this.curIndex = this.chapterIndexAtOffset(first.start);
      this.cursor = first.nextCursor;
    }
    return { segments: first.segments, done: first.segments.length === 0 };
  }

  jumpToChapter(oneBased: number): { segments: Segment[]; done: boolean } {
    const idx = Math.min(Math.max(1, oneBased), this.chapters.length) - 1;
    this.cursor = this.paginator.chapterStartOffset(idx);
    this.curIndex = -1;
    return this.nextChapter();
  }

  jumpToOffset(offset: number): { segments: Segment[]; done: boolean } {
    this.cursor = Math.min(Math.max(0, offset), this.text.length);
    this.curIndex = -1;
    return this.nextChapter();
  }

  /** The chapter currently being read (title + start offset). */
  currentChapter(): { index: number; title: string; startOffset: number } | undefined {
    const idx = this.curIndex >= 0 ? this.curIndex : this.chapterIndexAtOffset(this.cursor - 1);
    const c = this.chapters[idx];
    return c ? { index: idx, title: c.title, startOffset: c.startOffset } : undefined;
  }

  /** Segments of the chapter currently being read — for boss-mode restore. */
  lastChapterSegments(): Segment[] {
    const start = this.curIndex >= 0 ? this.chapters[this.curIndex].startOffset : 0;
    return this.collectChapter(start).segments;
  }

  search(query: string): SearchResult[] {
    return fullTextSearch(this.text, this.chapters, query);
  }

  currentChapterIndex(): number {
    return this.paginator.pageMetaFor(this.cursor).chapterIndex;
  }

  contextAround(offset: number, count = 2) {
    return this.paginator.contextAround(offset, count);
  }
}

export type { Segment } from './paginator';
