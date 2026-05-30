import { Chapter } from '../../types';

/** Common output of every structured parser (EPUB / FB2 / …). */
export interface ParsedBook {
  title: string;
  chapters: { title: string; text: string }[];
}

/**
 * Flatten pre-structured chapters into one text blob + a Chapter[] with exact
 * offsets, so the existing Paginator/ReaderEngine work unchanged. Each chapter
 * begins with its title line (which the Paginator renders as a chapter marker).
 */
export function chaptersToText(chs: { title: string; text: string }[]): {
  text: string;
  chapters: Chapter[];
} {
  let text = '';
  const chapters: Chapter[] = [];
  chs.forEach((ch, i) => {
    const start = text.length;
    const title = (ch.title || '').trim() || `第 ${i + 1} 章`;
    text += title + '\n' + ch.text.trim() + '\n\n';
    chapters.push({ index: i, title, startOffset: start, endOffset: text.length });
  });
  return { text, chapters };
}
