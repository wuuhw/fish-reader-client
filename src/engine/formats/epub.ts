import { unzipSync, strFromU8 } from 'fflate';
import { htmlToText, firstHeading, stripTags } from './html-text';
import { ParsedBook } from './structured';

/** Parse an EPUB (a ZIP of XHTML) into ordered chapters via its OPF spine. */
export function parseEpub(bytes: Uint8Array): ParsedBook {
  const files = unzipSync(bytes);
  const lower = new Map<string, string>();
  for (const k of Object.keys(files)) lower.set(k.toLowerCase(), k);

  const read = (path: string): string | undefined => {
    const real = files[path] ? path : lower.get(path.toLowerCase());
    return real ? strFromU8(files[real]) : undefined;
  };

  // 1. container.xml → OPF path
  let opfPath = '';
  const container = read('META-INF/container.xml');
  if (container) {
    const m = container.match(/full-path="([^"]+)"/i);
    if (m) opfPath = m[1];
  }
  if (!opfPath) {
    const k = Object.keys(files).find((f) => f.toLowerCase().endsWith('.opf'));
    if (k) opfPath = k;
  }
  const opf = opfPath ? read(opfPath) : undefined;
  if (!opf) throw new Error('无法解析 EPUB(缺少 OPF)');
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

  // 2. book title
  let title = '';
  const tm = opf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i) || opf.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (tm) title = stripTags(tm[1]);

  // 3. manifest: id → href (only xhtml/html docs)
  const manifest = new Map<string, string>();
  const itemRe = /<item\b[^>]*>/gi;
  let im: RegExpExecArray | null;
  while ((im = itemRe.exec(opf))) {
    const tag = im[0];
    const id = (tag.match(/\bid="([^"]+)"/i) || [])[1];
    const href = (tag.match(/\bhref="([^"]+)"/i) || [])[1];
    if (id && href) manifest.set(id, href);
  }

  // 4. spine order
  const spine: string[] = [];
  const sRe = /<itemref\b[^>]*>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = sRe.exec(opf))) {
    const idref = (sm[0].match(/\bidref="([^"]+)"/i) || [])[1];
    if (idref && manifest.has(idref)) spine.push(manifest.get(idref)!);
  }

  const resolve = (href: string): string => {
    let p: string;
    try {
      p = decodeURIComponent(href.split('#')[0]);
    } catch {
      p = href.split('#')[0];
    }
    const full = opfDir + p;
    const parts: string[] = [];
    for (const seg of full.split('/')) {
      if (seg === '..') parts.pop();
      else if (seg !== '.' && seg !== '') parts.push(seg);
    }
    return parts.join('/');
  };

  // 5. read each spine doc → text
  const chapters: { title: string; text: string }[] = [];
  for (const href of spine) {
    const html = read(resolve(href));
    if (!html) continue;
    const text = htmlToText(html);
    if (!text.trim()) continue;
    const heading = firstHeading(html);
    let body = text;
    // The heading is also the first text line — drop it so it isn't duplicated
    // when chaptersToText re-prepends the title.
    if (heading) {
      const nl = body.indexOf('\n');
      const firstLine = (nl === -1 ? body : body.slice(0, nl)).trim();
      if (firstLine === heading) body = nl === -1 ? '' : body.slice(nl + 1);
    }
    chapters.push({ title: heading ?? '', text: body });
  }

  if (!chapters.length) throw new Error('EPUB 中没有可读章节');
  return { title, chapters };
}
