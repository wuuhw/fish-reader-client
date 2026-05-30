// Shared data contracts for the desktop client (ported from the VSCode extension).

export interface BookMeta {
  id: string;
  path: string;
  title: string;
  totalChapters: number;
  totalChars: number;
}

export interface Chapter {
  index: number; // 0-based
  title: string;
  startOffset: number;
  endOffset: number;
}

export interface PageMeta {
  chapterIndex: number;
  chapterTitle: string;
  pageInChapter: number;
  pagesInChapter: number;
  charOffset: number;
  atChapterStart: boolean;
}

export type DiffLineType = 'add' | 'del' | 'ctx';

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

export interface DiffHunk {
  fileName: string;
  lang: string;
  header: string; // e.g. "@@ -10,6 +10,8 @@"
  category: string;
  lines: DiffLine[];
}

export interface FakeTurn {
  prompt: string;
  thinking: string[];
  analysis: string;
  diff?: DiffHunk;
}

export interface CommandSpec {
  name: string; // canonical, e.g. "/下一页"
  aliases: string[]; // e.g. ["/n", "/next"]
  description: string;
  paramHint?: string; // e.g. "<章节号>"
  display?: string; // short command shown in the slash menu, e.g. "/next"
}

export interface SearchResult {
  chapterIndex: number;
  chapterTitle: string;
  offset: number;
  snippet: string;
}

export interface LibBook {
  id: string;
  title: string;
  progressPct: number;
  totalChapters: number;
  lastReadAt: number;
}
