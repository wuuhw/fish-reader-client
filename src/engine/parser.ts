import { Chapter } from '../types';

/**
 * Split full text into chapters by a chapter-title regex (matched per line).
 * The portion before the first matched title becomes an implicit "卷首" chapter.
 */
export function splitChapters(text: string, regexSource: string): Chapter[] {
  let re: RegExp;
  try {
    re = new RegExp(regexSource, 'gmi');
  } catch {
    re = /^\s*(第[\d一二三四五六七八九十百千零两]+[章节卷回篇]|[Cc]hapter\s+\d+|楔子|序章|番外).*$/gmi;
  }

  const titles: { title: string; start: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const title = m[0].trim();
    if (title.length === 0 || title.length > 60) {
      if (m.index === re.lastIndex) re.lastIndex++;
      continue;
    }
    titles.push({ title, start: m.index });
    if (m.index === re.lastIndex) re.lastIndex++; // avoid zero-width loop
  }

  const chapters: Chapter[] = [];

  if (titles.length === 0) {
    chapters.push({ index: 0, title: '正文', startOffset: 0, endOffset: text.length });
    return chapters;
  }

  // Leading content before first title.
  if (titles[0].start > 0 && text.slice(0, titles[0].start).trim().length > 0) {
    chapters.push({
      index: 0,
      title: '卷首',
      startOffset: 0,
      endOffset: titles[0].start,
    });
  }

  for (let i = 0; i < titles.length; i++) {
    const start = titles[i].start;
    const end = i + 1 < titles.length ? titles[i + 1].start : text.length;
    chapters.push({
      index: chapters.length,
      title: titles[i].title,
      startOffset: start,
      endOffset: end,
    });
  }

  return chapters;
}

/**
 * Subdivide any chapter that is far larger than `targetChars` into virtual
 * pages, broken at paragraph (newline) boundaries. Fallback for books whose
 * chapter headings can't be detected. Pass targetChars <= 0 to disable.
 */
export function subdivideChapters(text: string, chapters: Chapter[], targetChars: number): Chapter[] {
  if (targetChars <= 0) return chapters.map((c, i) => ({ ...c, index: i }));
  const threshold = targetChars * 1.5;
  const out: Chapter[] = [];

  for (const ch of chapters) {
    const len = ch.endOffset - ch.startOffset;
    if (len <= threshold) {
      out.push(ch);
      continue;
    }
    let start = ch.startOffset;
    let part = 0;
    while (start < ch.endOffset) {
      part++;
      let end = Math.min(start + targetChars, ch.endOffset);
      if (end < ch.endOffset) {
        const nl = text.indexOf('\n', end);
        end = nl === -1 || nl >= ch.endOffset ? ch.endOffset : nl + 1;
      }
      if (ch.endOffset - end < targetChars * 0.3) end = ch.endOffset;
      out.push({
        index: 0,
        title: part === 1 ? ch.title : `${ch.title} ·${part}`,
        startOffset: start,
        endOffset: end,
      });
      start = end;
    }
  }

  return out.map((c, i) => ({ ...c, index: i }));
}

/** Derive a book title: filename without extension, else first short line, else fallback. */
export function deriveTitle(fileBaseName: string, text: string): string {
  const noExt = fileBaseName.replace(/\.[^.]+$/, '').trim();
  if (noExt && noExt.length <= 40) return noExt;

  const firstLine = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
  if (firstLine && firstLine.length < 30) return firstLine;

  return 'Unknown Book';
}
