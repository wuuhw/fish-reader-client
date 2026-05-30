// HTML/XHTML → plain reading text. Regex-based (no DOMParser) so the exact same
// code runs in the Tauri webview and in the VSCode Node extension host.

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', ldquo: '“', rdquo: '”',
  lsquo: '‘', rsquo: '’', middot: '·', laquo: '«', raquo: '»', copy: '©',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code =
        e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isNaN(code) ? m : safeCodePoint(code);
    }
    const v = NAMED[e.toLowerCase()];
    return v ?? m;
  });
}

function safeCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** Strip inline tags, decode entities, collapse spaces — for a small fragment. */
export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

/** Convert a full (X)HTML document/body to paragraph-preserving plain text. */
export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<\?[\s\S]*?\?>/g, ''); // xml prolog / processing instructions
  s = s.replace(/<!--[\s\S]*?-->/g, ''); // comments
  s = s.replace(/<head\b[\s\S]*?<\/head>/gi, '');
  s = s.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
  // block-level closings / breaks → newline
  s = s.replace(/<\/(p|div|h[1-6]|li|tr|blockquote|section|article|figcaption)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<(hr|empty-line)\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ''); // strip remaining tags
  s = decodeEntities(s);
  s = s.replace(/\r\n?/g, '\n');
  s = s.replace(/[ \t]+\n/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  s = s.replace(/[ \t]{2,}/g, ' ');
  return s.trim();
}

/** Best-effort chapter title from an (X)HTML doc: first heading, else <title>. */
export function firstHeading(html: string): string | undefined {
  const h = html.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
  if (h) {
    const t = stripTags(h[1]);
    if (t) return t;
  }
  const ti = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (ti) {
    const t = stripTags(ti[1]);
    if (t) return t;
  }
  return undefined;
}
