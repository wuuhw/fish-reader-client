import { DiffHunk, DiffLine, PageMeta, SearchResult } from '../types';
import { InsertBlock } from '../disguise/professions';
import { typeInto, revealLines } from './streaming';

/** Synthesize a plausible "@@ -N,x +N,y @@" header from diff lines. */
function diffHeader(lines: DiffLine[]): string {
  const adds = lines.filter((l) => l.type !== 'del').length;
  const dels = lines.filter((l) => l.type !== 'add').length;
  const start = 8 + Math.floor(Math.random() * 232);
  return `@@ -${start},${dels} +${start},${adds} @@`;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Minimal markdown: fenced code blocks, **bold**, `inline`, newlines. */
function renderMarkdown(container: HTMLElement, md: string) {
  const parts = md.split(/```/);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      const pre = el('pre', 'code-block');
      pre.textContent = part.replace(/^\n/, '').replace(/\n$/, '');
      container.appendChild(pre);
    } else {
      renderInline(container, part);
    }
  });
}

function renderInline(container: HTMLElement, text: string) {
  const lines = text.split('\n');
  lines.forEach((line, idx) => {
    if (idx > 0) container.appendChild(document.createElement('br'));
    const tokens = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    for (const tk of tokens) {
      if (!tk) continue;
      if (tk.startsWith('**') && tk.endsWith('**')) {
        container.appendChild(el('strong', undefined, tk.slice(2, -2)));
      } else if (tk.startsWith('`') && tk.endsWith('`')) {
        container.appendChild(el('code', 'inline-code', tk.slice(1, -1)));
      } else {
        container.appendChild(document.createTextNode(tk));
      }
    }
  });
}

export type CommandSink = (raw: string) => void;

/** Doubao desktop conversation renderer (full-width assistant, right-aligned user bubble). */
export class UI {
  private mainTitle: HTMLElement;
  private bookTitle = '';

  constructor(
    private log: HTMLElement,
    private sink: CommandSink
  ) {
    this.mainTitle = document.getElementById('main-title')!;
  }

  scroll() {
    this.log.scrollTop = this.log.scrollHeight;
  }

  clear() {
    this.log.textContent = '';
  }

  // ---- page scroll anchoring (pin viewport to start of a freshly-rendered page) ----
  private anchor = 0;
  markAnchor() {
    this.anchor = this.log.scrollHeight;
  }
  pinAnchor() {
    this.log.scrollTop = Math.min(this.anchor, this.log.scrollHeight - this.log.clientHeight);
  }

  // ---- user message (right-aligned gray bubble) ----
  user(text: string) {
    const row = el('div', 'msg-row');
    const bubble = el('div', 'user-bubble');
    bubble.textContent = text;
    row.appendChild(bubble);
    this.log.appendChild(row);
    this.scroll();
  }

  /** Begin a full-width assistant message; returns its body element. */
  private beginAI(label?: string): { msg: HTMLElement; body: HTMLElement } {
    const msg = el('div', 'ai-msg');
    if (label) msg.appendChild(el('div', 'bubble-label', label));
    const body = el('div', 'bubble-body');
    msg.appendChild(body);
    this.log.appendChild(msg);
    return { msg, body };
  }

  beginAssistant(label?: string): { turn: HTMLElement; body: HTMLElement } {
    const { msg, body } = this.beginAI(label);
    return { turn: msg, body };
  }

  // ---- thinking (three bouncing dots + streamed log) ----
  async thinking(lines: string[]) {
    const { body } = this.beginAI();
    const head = el('div', 'thinking-head');
    const dots = el('span', 'think-dots');
    for (let i = 0; i < 3; i++) dots.appendChild(el('span', 'think-dot'));
    head.appendChild(dots);
    head.appendChild(el('span', 'thinking-label', '思考中'));
    body.appendChild(head);
    const logBox = el('div', 'thinking-log');
    body.appendChild(logBox);

    await revealLines(
      lines,
      (line) => logBox.appendChild(el('div', 'thinking-line', line)),
      () => this.scroll()
    );
  }

  async streamText(label: string | undefined, text: string) {
    const { body } = this.beginAI(label);
    const cursor = el('span', 'cursor');
    body.appendChild(cursor);
    const textSpan = el('span', 'stream-span');
    body.insertBefore(textSpan, cursor);
    await typeInto(textSpan, text, () => this.scroll());
    cursor.remove();
  }

  /** Render assistant text that may contain markdown (no char streaming). */
  staticText(label: string | undefined, md: string, markdown: boolean) {
    const { body } = this.beginAI(label);
    if (markdown) renderMarkdown(body, md);
    else renderInline(body, md);
    this.scroll();
  }

  // ---- paragraph (novel content) — instant, no streaming ----
  paragraph(text: string, meta: PageMeta, diffs: DiffHunk[]) {
    if (meta.atChapterStart) {
      const row = el('div', 'chapter-divider');
      row.appendChild(el('span', 'chapter-divider-text', meta.chapterTitle));
      this.log.appendChild(row);
      return;
    }
    const { msg, body } = this.beginAI();
    const textSpan = el('div', 'novel-text');
    textSpan.textContent = text;
    body.appendChild(textSpan);
    for (const d of diffs) this.diff(msg, d, true);
  }

  /** A disguise turn between paragraphs: a one-line note + a work artifact (instant). */
  disguiseInsert(label: string, note: string, block: InsertBlock) {
    const { msg, body } = this.beginAI(label);
    if (note) {
      const noteEl = el('div', 'analysis-text');
      noteEl.textContent = note;
      body.appendChild(noteEl);
    }
    void this.renderInsert(msg, block, true);
  }

  /** Render any "work artifact" block (the generalized insert stream). */
  async renderInsert(parent: HTMLElement, block: InsertBlock, instant = true) {
    switch (block.kind) {
      case 'diff':
        await this.diff(
          parent,
          { fileName: block.fileName, lang: '', header: diffHeader(block.lines), category: '', lines: block.lines },
          instant
        );
        break;
      case 'code':
        this.codeArtifact(parent, block.title, block.lines);
        break;
      case 'table':
        this.tableArtifact(parent, block.title, block.headers, block.rows);
        break;
      case 'list':
        this.listArtifact(parent, block.title, block.items, block.ordered);
        break;
      case 'doc':
        this.docArtifact(parent, block.title, block.paragraphs);
        break;
    }
  }

  private workBlock(parent: HTMLElement, title: string): HTMLElement {
    const block = el('div', 'work-block');
    if (title) {
      const head = el('div', 'work-head');
      head.appendChild(el('span', 'work-title', title));
      block.appendChild(head);
    }
    const body = el('div', 'work-body');
    block.appendChild(body);
    parent.appendChild(block);
    return body;
  }

  private codeArtifact(parent: HTMLElement, title: string, lines: string[]) {
    const body = this.workBlock(parent, title);
    const pre = el('pre', 'work-code');
    pre.textContent = lines.join('\n');
    body.appendChild(pre);
  }

  private tableArtifact(parent: HTMLElement, title: string, headers: string[], rows: string[][]) {
    const body = this.workBlock(parent, title);
    const table = el('table', 'work-table');
    if (headers.length) {
      const thead = el('thead');
      const tr = el('tr');
      headers.forEach((h) => tr.appendChild(el('th', undefined, h)));
      thead.appendChild(tr);
      table.appendChild(thead);
    }
    const tbody = el('tbody');
    rows.forEach((r) => {
      const tr = el('tr');
      r.forEach((cell) => tr.appendChild(el('td', undefined, cell)));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    body.appendChild(table);
  }

  private listArtifact(parent: HTMLElement, title: string, items: string[], ordered?: boolean) {
    const body = this.workBlock(parent, title);
    const list = el(ordered ? 'ol' : 'ul', 'work-list');
    items.forEach((it) => list.appendChild(el('li', undefined, it)));
    body.appendChild(list);
  }

  private docArtifact(parent: HTMLElement, title: string, paragraphs: string[]) {
    const body = this.workBlock(parent, title);
    paragraphs.forEach((p) => body.appendChild(el('p', 'work-para', p)));
  }

  // ---- diff block ----
  async diff(parent: HTMLElement, hunk: DiffHunk, instant = false) {
    const block = el('div', 'diff-block');
    const head = el('div', 'diff-head');
    head.appendChild(el('span', 'diff-file', hunk.fileName));
    head.appendChild(el('span', 'diff-meta', hunk.header));
    block.appendChild(head);
    const bodyEl = el('div', 'diff-body');
    block.appendChild(bodyEl);
    parent.appendChild(block);

    const appendLine = (line: DiffLine) => {
      const row = el('div', `diff-line diff-${line.type}`);
      const sign = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
      row.appendChild(el('span', 'diff-sign', sign));
      row.appendChild(el('span', 'diff-code', line.text));
      bodyEl.appendChild(row);
    };

    if (instant) {
      hunk.lines.forEach(appendLine);
    } else {
      await revealLines(hunk.lines, appendLine, () => this.scroll());
    }
  }

  // ---- toc ----
  toc(chapters: { index: number; title: string }[], current: number) {
    const { body } = this.beginAI('目录');
    const list = el('div', 'toc-list');
    chapters.forEach((c) => {
      const item = el('div', 'toc-item' + (c.index === current ? ' toc-current' : ''));
      item.textContent = `${c.index + 1}. ${c.title}`;
      item.addEventListener('click', () => this.sink(`/跳转 ${c.index + 1}`));
      list.appendChild(item);
    });
    body.appendChild(list);
    this.scroll();
  }

  // ---- search ----
  search(query: string, results: SearchResult[]) {
    const { body } = this.beginAI(`搜索 “${query}”`);
    if (!results.length) {
      body.appendChild(el('div', undefined, `没有找到 "${query}"`));
      this.scroll();
      return;
    }
    body.appendChild(el('div', 'muted', `${results.length} 处匹配:`));
    const list = el('div', 'search-list');
    results.forEach((r) => {
      const item = el('div', 'search-item');
      item.appendChild(el('span', 'search-chap', `[${r.chapterTitle}] `));
      item.appendChild(el('span', undefined, r.snippet));
      item.addEventListener('click', () => this.sink(`/跳转 ${r.chapterIndex + 1}`));
      list.appendChild(item);
    });
    body.appendChild(list);
    this.scroll();
  }

  // ---- action buttons (web-novel chooser / manual-record entry) ----
  actions(label: string | undefined, buttons: { label: string; onClick: () => void }[]) {
    const { body } = this.beginAI(label);
    const row = el('div', 'action-row');
    for (const b of buttons) {
      const btn = el('button', 'action-btn', b.label);
      btn.addEventListener('click', () => b.onClick());
      row.appendChild(btn);
    }
    body.appendChild(row);
    this.scroll();
  }

  // ---- web 目录 (clickable chapter list fetched from a site) ----
  webToc(title: string, chapters: { title: string; onClick: () => void }[]) {
    const { body } = this.beginAI(title || '目录');
    const list = el('div', 'toc-list');
    chapters.forEach((c) => {
      const item = el('div', 'toc-item');
      item.textContent = c.title;
      item.addEventListener('click', () => c.onClick());
      list.appendChild(item);
    });
    body.appendChild(list);
    this.scroll();
  }

  // ---- chrome ----
  setMainTitle(text: string) {
    this.mainTitle.textContent = text || '豆包';
  }

  setBookTitle(title: string) {
    this.bookTitle = title || '';
    this.setMainTitle(this.bookTitle || '豆包');
  }

  /** Restore the reading title (used when leaving boss mode). */
  restoreTitle() {
    this.setMainTitle(this.bookTitle || '豆包');
  }
}
