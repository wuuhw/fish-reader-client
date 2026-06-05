// Progress persistence. In-memory store hydrated once from the Rust side
// (app config dir JSON) and written through on every mutation.

import { loadStateRaw, saveStateRaw } from '../tauri';

export interface Bookmark {
  offset: number;
  label: string;
  createdAt: number;
}

/** Web-novel specifics, present only on records that came from a URL. */
export interface WebBookData {
  currentUrl: string; // last-read chapter URL (resume point)
  tocUrl?: string; // 目录 page URL
  tocCached?: boolean; // whether the chapter list has been fetched + cached
}

export interface BookRecord {
  id: string;
  path: string;
  title: string;
  totalChapters: number;
  totalChars: number;
  position: number; // start offset of the last shown segment
  lastReadAt: number;
  bookmarks: Bookmark[];
  hidden?: boolean; // hidden from the 历史对话 list but kept on disk
  web?: WebBookData; // present → this is a web-novel record, not a local file
}

interface StoreShape {
  books: BookRecord[];
  lastBookId?: string;
}

/** Stable id derived from a file path (FNV-1a hash, hex). */
export function bookId(path: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < path.length; i++) {
    h ^= path.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export class StateStore {
  private data: StoreShape = { books: [] };

  /** Hydrate from disk. Call once at startup before reading. */
  async init(): Promise<void> {
    try {
      const raw = await loadStateRaw();
      const parsed = JSON.parse(raw) as StoreShape;
      if (parsed && Array.isArray(parsed.books)) {
        this.data = { books: parsed.books, lastBookId: parsed.lastBookId };
      }
    } catch {
      this.data = { books: [] };
    }
  }

  private flush() {
    void saveStateRaw(JSON.stringify(this.data));
  }

  getBooks(): BookRecord[] {
    return this.data.books;
  }

  getBook(id: string): BookRecord | undefined {
    return this.data.books.find((b) => b.id === id);
  }

  getLastBook(): BookRecord | undefined {
    return this.data.lastBookId
      ? this.data.books.find((b) => b.id === this.data.lastBookId)
      : undefined;
  }

  upsertBook(rec: BookRecord): void {
    const i = this.data.books.findIndex((b) => b.id === rec.id);
    if (i === -1) this.data.books.push(rec);
    else this.data.books[i] = { ...this.data.books[i], ...rec };
    this.data.lastBookId = rec.id;
    this.flush();
  }

  setPosition(id: string, position: number): void {
    const b = this.data.books.find((bk) => bk.id === id);
    if (b) {
      b.position = position;
      b.lastReadAt = Date.now();
      this.data.lastBookId = id;
      this.flush();
    }
  }

  setLastBook(id: string): void {
    this.data.lastBookId = id;
    this.flush();
  }

  addBookmark(id: string, bm: Bookmark): void {
    const b = this.data.books.find((bk) => bk.id === id);
    if (b) {
      b.bookmarks.push(bm);
      this.flush();
    }
  }

  /** Permanently remove a book record (历史对话 删除). */
  removeBook(id: string): void {
    this.data.books = this.data.books.filter((b) => b.id !== id);
    if (this.data.lastBookId === id) this.data.lastBookId = undefined;
    this.flush();
  }

  /** Hide a book from the list without deleting it (历史对话 隐藏). */
  setHidden(id: string, hidden: boolean): void {
    const b = this.data.books.find((bk) => bk.id === id);
    if (b) {
      b.hidden = hidden;
      this.flush();
    }
  }

  /** Books that should appear in the 历史对话 list (not hidden), newest first. */
  visibleBooks(): BookRecord[] {
    return this.data.books
      .filter((b) => !b.hidden)
      .slice()
      .sort((a, b) => b.lastReadAt - a.lastReadAt);
  }
}
