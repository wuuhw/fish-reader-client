// Generic novel-page extractor (reading-mode). Runs in the Tauri webview, so
// DOMParser is available. Strategy mirrors browser "reader view":
//   • content  → site rule → semantic container → strip-junk-then-densest block
//   • nav      → site rule → rel=next/prev/contents → 关键词 anchors → JS 变量
// Pure given (html, baseUrl[, rule]); returns content + nav + a confidence so
// the caller can decide whether to suggest 手动识别.

export interface SiteRule {
  host: string;
  contentSelector?: string;
  nextSelector?: string;
  prevSelector?: string;
  tocSelector?: string;
  tocLinkSelector?: string;
}

export interface WebChapter {
  title: string; // chapter title
  bookTitle: string; // novel title (for the library entry)
  paragraphs: string[];
  nextUrl?: string;
  prevUrl?: string;
  tocUrl?: string;
  confidence: number; // 0..1 — below ~0.5 suggests 手动识别
  reason: string; // why confidence is low (shown to the user)
}

export interface TocResult {
  title: string;
  chapters: { title: string; url: string }[];
}

// Block tags that imply a paragraph break when flattening to text.
const BLOCK = new Set(['p', 'div', 'br', 'li', 'h1', 'h2', 'h3', 'tr', 'section', 'article']);
// Junk we strip before reading content (nav bars, scripts, ads, comments).
const JUNK_SEL =
  'script,style,noscript,iframe,a.nav,.nav,nav,header,footer,.header,.footer,' +
  '.toplink,.bottomlink,#guild,#footer,#header,.crumb,.breadcrumb,.bookname>a,' +
  '.page,.pagelink,.link,.ad,.ads,[id*="ad"],[class*="ad-"],#Commenddiv,#feit2';
// Semantic content containers, most-specific first.
const CONTENT_SEL = [
  '#chaptercontent', '#content', '#booktxt', '#BookText', '#htmlContent',
  '#nr1', '#nr_content', '#TextContent', '.read-content', '.article-content',
  '.content_read', '[itemprop="articleBody"]', '.articlebody', '.content', '#text',
];

function abs(href: string | null | undefined, base: string): string | undefined {
  if (!href) return undefined;
  const h = href.trim();
  if (!h || h.startsWith('#') || h.startsWith('javascript:')) return undefined;
  try {
    return new URL(h, base).href;
  } catch {
    return undefined;
  }
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

/** Recursively flatten an element to text, inserting \n at block / <br> edges. */
function flatten(el: Element): string {
  const out: string[] = [];
  const walk = (node: Node) => {
    node.childNodes.forEach((c) => {
      if (c.nodeType === 3) {
        out.push(c.textContent ?? '');
      } else if (c.nodeType === 1) {
        const tag = (c as Element).tagName.toLowerCase();
        if (tag === 'br') {
          out.push('\n');
        } else {
          const block = BLOCK.has(tag);
          if (block) out.push('\n');
          walk(c);
          if (block) out.push('\n');
        }
      }
    });
  };
  walk(el);
  return out.join('');
}

/** A line that's just a nav control / boilerplate, not story text. */
function isJunkLine(line: string): boolean {
  if (line.length <= 1) return true;
  return /^(上一[页章节]|下一[页章节]|返回目录|目录|加入书签|章节报错|手机阅读|推荐本书|加入书架|上一页|下一页)$/.test(
    line
  );
}

function linesFrom(el: Element): string[] {
  return flatten(el)
    .replace(/ /g, ' ')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l && !isJunkLine(l));
}

function chineseCount(s: string): number {
  const m = s.match(/[一-鿿]/g);
  return m ? m.length : 0;
}

/** Link-text density of a block — high means it's a nav/list, not prose. */
function linkDensity(el: Element): number {
  const total = (el.textContent ?? '').length || 1;
  let linked = 0;
  el.querySelectorAll('a').forEach((a) => (linked += (a.textContent ?? '').length));
  return linked / total;
}

/** Pick the content container: rule → semantic → densest stripped block. */
function pickContent(doc: Document, rule?: SiteRule): Element | undefined {
  if (rule?.contentSelector) {
    const el = doc.querySelector(rule.contentSelector);
    if (el) return el;
  }
  for (const sel of CONTENT_SEL) {
    const el = doc.querySelector(sel);
    if (el && chineseCount(el.textContent ?? '') > 150 && linkDensity(el) < 0.3) return el;
  }
  // Density fallback: scan blocks, score by chinese-text minus link density.
  let best: Element | undefined;
  let bestScore = 0;
  doc.querySelectorAll('div,article,section,td').forEach((el) => {
    const cc = chineseCount(el.textContent ?? '');
    if (cc < 200) return;
    const score = cc * (1 - linkDensity(el));
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  });
  // piaotia-style bare body text: fall back to <body> after junk removal.
  return best ?? doc.body ?? undefined;
}

interface NavLinks {
  nextUrl?: string;
  prevUrl?: string;
  tocUrl?: string;
}

function findNav(doc: Document, html: string, base: string, rule?: SiteRule): NavLinks {
  const out: NavLinks = {};

  const fromSel = (sel?: string) =>
    sel ? abs(doc.querySelector(sel)?.getAttribute('href'), base) : undefined;

  // 1) site rule
  out.nextUrl = fromSel(rule?.nextSelector);
  out.prevUrl = fromSel(rule?.prevSelector);
  out.tocUrl = fromSel(rule?.tocSelector);

  // 2) rel attributes (quanben uses rel="next"/"pre"/"contents")
  out.nextUrl ??= abs(doc.querySelector('a[rel~="next"]')?.getAttribute('href'), base);
  out.prevUrl ??= abs(
    doc.querySelector('a[rel~="prev"],a[rel~="previous"],a[rel~="pre"]')?.getAttribute('href'),
    base
  );
  out.tocUrl ??= abs(doc.querySelector('a[rel~="contents"]')?.getAttribute('href'), base);

  // 3) anchor-text keywords (the common case for 笔趣阁-family sites)
  if (!out.nextUrl || !out.prevUrl || !out.tocUrl) {
    doc.querySelectorAll('a[href]').forEach((a) => {
      const t = (a.textContent ?? '').replace(/\s+/g, '').trim();
      const href = abs(a.getAttribute('href'), base);
      if (!href) return;
      if (!out.nextUrl && /^(下一[页章节]|下页|下一篇)$/.test(t)) out.nextUrl = href;
      else if (!out.prevUrl && /^(上一[页章节]|上页|上一篇)$/.test(t)) out.prevUrl = href;
      else if (!out.tocUrl && /^((返回)?目录|章节目录|返回书页)$/.test(t)) out.tocUrl = href;
    });
  }

  // 4) JS variables (笔趣阁 clones embed next_page / preview_page / index_page)
  const jsVar = (name: string) =>
    new RegExp(name + '\\s*=\\s*["\\\']([^"\\\']+)["\\\']').exec(html)?.[1];
  out.nextUrl ??= abs(jsVar('next_page'), base);
  out.prevUrl ??= abs(jsVar('preview_page') ?? jsVar('prev_page'), base);
  out.tocUrl ??= abs(jsVar('index_page'), base);

  return out;
}

function pickTitle(doc: Document, paragraphs: string[]): string {
  const h1 = doc.querySelector('h1')?.textContent?.trim();
  if (h1 && h1.length < 60) return h1;
  // A leading "第X章 …" paragraph is usually the chapter title.
  if (paragraphs[0] && /第.{1,8}[章节回].{0,20}/.test(paragraphs[0]) && paragraphs[0].length < 40) {
    return paragraphs[0];
  }
  const t = doc.title || '';
  // "盘龙最新章节,第六集 … ,PT文学" → take the chaptery middle segment.
  const seg = t.split(/[,，_\-|]/).map((s) => s.trim()).find((s) => /第.{1,8}[章节回]/.test(s));
  return seg || t.split(/[,，_\-|]/)[0]?.trim() || '网页章节';
}

/** Best-effort novel title (for the library entry), distinct from chapter title. */
function pickBookTitle(doc: Document): string {
  const el = doc.querySelector('.bookname,.book-name,#bookname,.bookTitle,h1 a, .info h1');
  const fromEl = el?.textContent?.trim();
  if (fromEl && fromEl.length < 40) return fromEl;
  // From <title>: drop site suffix, 最新章节, and any 第X章 chapter part.
  const parts = (doc.title || '')
    .split(/[,，_\-|·]/)
    .map((s) => s.replace(/最新章节|在线阅读|免费阅读|TXT下载|无弹窗/g, '').trim())
    .filter((s) => s && !/第.{1,8}[章节回]/.test(s) && s.length < 30);
  // The novel name is usually the shortest "clean" segment.
  parts.sort((a, b) => a.length - b.length);
  return parts[0] || '网页小说';
}

/** Extract one chapter from a page. */
export function extractChapter(html: string, baseUrl: string, rule?: SiteRule): WebChapter {
  const doc = parse(html);
  const container = pickContent(doc, rule);

  let paragraphs: string[] = [];
  if (container) {
    // Strip junk from a clone so nav/ads don't leak into the text.
    const clone = container.cloneNode(true) as Element;
    clone.querySelectorAll(JUNK_SEL).forEach((n) => n.remove());
    paragraphs = linesFrom(clone).filter((l) => chineseCount(l) > 0 || l.length > 8);
  }

  const nav = findNav(doc, html, baseUrl, rule);
  const title = pickTitle(doc, paragraphs);
  const bookTitle = pickBookTitle(doc);

  const totalChars = paragraphs.reduce((n, p) => n + p.length, 0);
  const cc = paragraphs.reduce((n, p) => n + chineseCount(p), 0);

  // Confidence + reason.
  let confidence = 0;
  const reasons: string[] = [];
  if (totalChars >= 500) confidence += 0.55;
  else reasons.push('正文偏短');
  if (totalChars > 0 && cc / totalChars > 0.4) confidence += 0.2;
  if (nav.nextUrl) confidence += 0.25;
  else reasons.push('没找到「下一页」');
  confidence = Math.min(1, confidence);

  return {
    title,
    bookTitle,
    paragraphs,
    nextUrl: nav.nextUrl,
    prevUrl: nav.prevUrl,
    tocUrl: nav.tocUrl,
    confidence,
    reason: reasons.join('、') || '识别正常',
  };
}

/** Extract a chapter list from a 目录 page. */
export function extractToc(html: string, baseUrl: string, rule?: SiteRule): TocResult {
  const doc = parse(html);
  const title = (doc.querySelector('h1')?.textContent ?? doc.title ?? '目录').trim();

  // Find the densest list of same-host chapter links.
  let host = '';
  try {
    host = new URL(baseUrl).host;
  } catch {
    /* ignore */
  }

  const scope = rule?.tocLinkSelector
    ? doc.querySelectorAll(rule.tocLinkSelector)
    : bestLinkContainer(doc).querySelectorAll('a[href]');

  const chapters: { title: string; url: string }[] = [];
  const seen = new Set<string>();
  scope.forEach((a) => {
    const url = abs(a.getAttribute('href'), baseUrl);
    const t = (a.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!url || !t || seen.has(url)) return;
    try {
      if (new URL(url).host !== host) return;
    } catch {
      return;
    }
    seen.add(url);
    chapters.push({ title: t, url });
  });

  return { title, chapters };
}

/** The element holding the most links — the 目录 list, usually. */
function bestLinkContainer(doc: Document): Element {
  let best: Element = doc.body ?? doc.documentElement;
  let bestN = 0;
  doc.querySelectorAll('ul,ol,div,dl').forEach((el) => {
    const n = el.querySelectorAll(':scope > a, :scope > li > a, :scope > dd > a').length;
    if (n > bestN) {
      bestN = n;
      best = el;
    }
  });
  return best;
}
