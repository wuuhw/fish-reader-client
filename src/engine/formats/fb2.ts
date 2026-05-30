import { unzipSync } from 'fflate';
import { htmlToText, stripTags } from './html-text';
import { ParsedBook } from './structured';

/** Decode FB2 bytes honoring the XML prolog's declared encoding. */
function decodeXml(bytes: Uint8Array): string {
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 200));
  const m = head.match(/encoding="([^"]+)"/i);
  const enc = (m ? m[1] : 'utf-8').toLowerCase();
  try {
    return new TextDecoder(enc).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** Extract `<p>` (and verse `<v>`) text from a fragment, one per line. */
function paragraphs(fragment: string): string {
  const out: string[] = [];
  const re = /<(p|v)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment))) {
    const t = htmlToText(m[2]);
    if (t.trim()) out.push(t.trim());
  }
  return out.join('\n');
}

/**
 * Parse FB2 (FictionBook, a single XML file; or a .fb2.zip). Chapters are split
 * at `<title>` markers inside `<body>`; text between a title and the next is the
 * chapter body. Handles both flat and nested sections reasonably.
 */
export function parseFb2(input: Uint8Array): ParsedBook {
  let bytes = input;
  // .fb2.zip → take the first .fb2 entry
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const files = unzipSync(bytes);
    const k = Object.keys(files).find((f) => f.toLowerCase().endsWith('.fb2')) ?? Object.keys(files)[0];
    if (k) bytes = files[k];
  }

  const xml = decodeXml(bytes);

  let title = '';
  const tm = xml.match(/<book-title[^>]*>([\s\S]*?)<\/book-title>/i);
  if (tm) title = stripTags(tm[1]);

  const bodyM = xml.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyM ? bodyM[1] : xml;

  const chapters: { title: string; text: string }[] = [];
  const titleRe = /<title\b[^>]*>([\s\S]*?)<\/title>/gi;
  const marks: { title: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = titleRe.exec(body))) {
    marks.push({ title: stripTags(m[1]), start: m.index, end: m.index + m[0].length });
  }

  if (!marks.length) {
    const text = paragraphs(body);
    if (text.trim()) chapters.push({ title: '', text });
  } else {
    // text before the first title (a prologue), if substantial
    const pre = paragraphs(body.slice(0, marks[0].start));
    if (pre.trim().length > 40) chapters.push({ title: '卷首', text: pre });
    for (let i = 0; i < marks.length; i++) {
      const bodyStart = marks[i].end;
      const bodyEnd = i + 1 < marks.length ? marks[i + 1].start : body.length;
      const text = paragraphs(body.slice(bodyStart, bodyEnd));
      if (text.trim()) chapters.push({ title: marks[i].title, text });
    }
  }

  if (!chapters.length) throw new Error('FB2 中没有可读章节');
  return { title, chapters };
}
