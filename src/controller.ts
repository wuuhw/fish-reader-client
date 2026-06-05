import { UI } from './ui/dom';
import { ReaderEngine, Segment } from './engine/reader';
import { StateStore, BookRecord, bookId } from './engine/state';
import { COMMANDS, parseInput } from './commands/registry';
import { resolveProfession, pickReadingInsert, nextBossTurns, bossTurnsForKey } from './disguise/professions';
import { initThinkingLog } from './disguise/thinking-animator';
import { AppConfig, mergeTarget } from './config';
import { parseEpub } from './engine/formats/epub';
import { parseFb2 } from './engine/formats/fb2';
import { chaptersToText } from './engine/formats/structured';
import { readBook, readBytes, bossWindow, fetchUrl } from './tauri';
import { extractChapter, extractToc, WebChapter } from './engine/web/extract';
import { getRuleForUrl, saveRule, hostOf } from './engine/web/rules';
import { getCachedToc, setCachedToc, clearCachedToc } from './engine/web/toc-cache';
import { PageMeta } from './types';

export type BossTrigger = 'hotkey' | 'button' | 'mouseLeave' | 'blur' | 'command';

export interface ControllerHooks {
  /** Append an animation task to the sequential render queue. */
  enqueue: (task: () => Promise<void>) => void;
  /** Drop pending tasks, abort in-flight streams, clear the log. */
  hardReset: () => void;
  /** Notify the host that the book list / progress changed. */
  onBooksChanged?: () => void;
  /** Notify the host that boss mode toggled (swap sidebar titles + main title). */
  onBossChange?: (active: boolean) => void;
  /** Open the 目录 panel (host owns the panel UI). */
  onToc?: () => void;
}

/** Stable per-novel key (same for every chapter) → the library record id.
 * Prefer the 目录 URL; else the chapter URL's directory. */
function webBookKey(chapterUrl: string, tocUrl?: string): string {
  if (tocUrl) return tocUrl;
  try {
    const u = new URL(chapterUrl);
    u.hash = '';
    u.search = '';
    u.pathname = u.pathname.replace(/\/[^/]*$/, '/'); // drop the filename
    return u.href;
  } catch {
    return chapterUrl;
  }
}

/** Active web-novel reading session (chapter-by-chapter, lazy-fetched). */
interface WebSession {
  bookId: string; // the library record this session reads/updates
  host: string;
  url: string;
  title: string;
  nextUrl?: string;
  prevUrl?: string;
  tocUrl?: string;
}

export class Controller {
  private engine?: ReaderEngine;
  private web?: WebSession; // active web-novel reading session (mutually exclusive with engine)
  private bossActive = false;
  private bossTrigger?: BossTrigger;
  private bossSavedPosition = 0;
  private bossSelectedId?: string; // which 历史对话 row is shown in boss mode
  private mouseLeaveTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private ui: UI,
    private state: StateStore,
    private cfg: AppConfig,
    private hooks: ControllerHooks
  ) {}

  private enqueue(task: () => Promise<void>) {
    this.hooks.enqueue(task);
  }

  get isBoss() {
    return this.bossActive;
  }

  /** Id of the book currently open (for sidebar highlighting). */
  currentBookId(): string | undefined {
    return this.engine?.meta.id ?? this.web?.bookId;
  }

  /** Id of the 历史对话 row shown in boss mode (for sidebar highlight). */
  currentBossId(): string | undefined {
    return this.bossSelectedId;
  }

  /**
   * Boss mode: switch the shown 历史对话 to another (fake) conversation — like
   * clicking a different chat. Clears the view and renders that row's stable,
   * distinct fake conversation, then highlights it.
   */
  selectBossConversation(id: string) {
    if (!this.bossActive || this.cfg.bossAction !== 'disguise') return;
    this.bossSelectedId = id;
    this.hooks.hardReset();
    this.emitBossConversationFor(id);
    this.hooks.onBooksChanged?.(); // re-render sidebar so the row highlights
  }

  /** If the open book was deleted/hidden from the sidebar, drop it from view. */
  forgetBookIfOpen(id: string) {
    if (this.engine?.meta.id === id || this.web?.bookId === id) {
      this.engine = undefined;
      this.web = undefined;
      this.hooks.hardReset();
      this.ui.setBookTitle('');
      this.showWelcome();
    }
    clearCachedToc(id); // drop any cached 目录 for the removed book
  }

  // ---------- lifecycle ----------
  async start() {
    await this.restoreLast();
  }

  /** Start a fresh reading session (caller is expected to hardReset first). */
  startNewSession() {
    this.engine = undefined;
    this.web = undefined;
    this.ui.setBookTitle('');
    this.showWelcome();
  }

  private showWelcome() {
    this.enqueue(async () =>
      this.ui.staticText(
        undefined,
        `你好,我是 **${this.cfg.avatarName || '豆包'}** 👋\n\n把一本 txt 拖进来,或输入 \`/init <文件路径>\` 开始阅读。\n输入 \`/help\` 查看全部命令。`,
        true
      )
    );
  }

  async openBookById(id: string) {
    const rec = this.state.getBook(id);
    if (!rec) {
      this.showWelcome();
      return;
    }
    if (rec.web?.currentUrl) {
      await this.webOpen(rec.web.currentUrl); // resume web novel at last chapter
      return;
    }
    await this.switchBook(rec);
  }

  private async restoreLast() {
    const rec = this.state.getLastBook();
    if (!rec) {
      this.showWelcome();
      return;
    }
    if (rec.web?.currentUrl) {
      this.enqueue(async () => this.ui.streamText(undefined, `正在恢复《${rec.title}》…`));
      await this.webOpen(rec.web.currentUrl);
      return;
    }
    try {
      await this.loadBook(rec.path, rec.position);
      this.enqueue(async () =>
        this.ui.streamText(undefined, `已恢复《${rec.title}》上次阅读位置`)
      );
      this.cmdNext();
    } catch {
      this.enqueue(async () =>
        this.ui.staticText(
          undefined,
          `无法打开上次的书:${rec.path}(文件可能已移动)。用 /init 重新关联。`,
          false
        )
      );
    }
  }

  // ---------- input dispatch ----------
  async handleInput(raw: string) {
    const text = raw.trim();
    if (!text) return;

    // In boss mode, never respond to reading commands; emit another fake turn.
    if (this.bossActive) {
      const p = parseInput(text);
      if (p.cmd === '/恢复' || p.cmd === '/boss') {
        this.exitBoss();
        return;
      }
      this.emitBossTurns(1);
      return;
    }

    this.enqueue(async () => this.ui.user(text));
    const p = parseInput(text);

    if (!text.startsWith('/')) {
      this.enqueue(async () =>
        this.ui.staticText(undefined, '未识别的输入。输入 / 查看命令,或 /help。', false)
      );
      return;
    }

    switch (p.cmd) {
      case '/init':
        await this.cmdInit(p.args);
        break;
      case '/目录':
        this.cmdToc();
        break;
      case '/下一页':
        this.cmdNext();
        break;
      case '/上一页':
        this.cmdPrev();
        break;
      case '/跳转':
        this.cmdJump(p.args);
        break;
      case '/搜索':
        this.cmdSearch(p.args);
        break;
      case '/书签':
        this.cmdBookmark(p.args);
        break;
      case '/历史':
        this.cmdHistory(p.args);
        break;
      case '/设置':
        this.cmdSettings();
        break;
      case '/boss':
        this.toggleBoss('command');
        break;
      case '/恢复':
        if (this.bossActive) this.exitBoss();
        else this.enqueue(async () => this.ui.staticText(undefined, '当前已是摸鱼态。', false));
        break;
      case '/help':
        this.cmdHelp();
        break;
      default:
        this.enqueue(async () =>
          this.ui.staticText(undefined, `未知命令:${p.cmd}。输入 /help 查看全部。`, false)
        );
    }
  }

  // ---------- /init ----------
  private async loadBook(filePath: string, position = 0) {
    this.web = undefined; // opening a local book leaves web mode
    const baseName = filePath.split(/[\\/]/).pop() ?? 'book.txt';
    const ext = baseName.toLowerCase().split('.').pop() ?? '';
    const baseOpts = {
      charsPerPage: this.cfg.charsPerPage,
      chapterRegex: this.cfg.chapterRegex,
      maxChapterChars: this.cfg.maxChapterChars,
      mergeTarget: mergeTarget(this.cfg),
    };

    let usedEnc: string;
    let byteSize: number;

    if (ext === 'epub' || ext === 'fb2') {
      const { bytes, byteSize: bs } = await readBytes(filePath);
      byteSize = bs;
      const parsed = ext === 'epub' ? parseEpub(bytes) : parseFb2(bytes);
      const built = chaptersToText(parsed.chapters);
      usedEnc = ext.toUpperCase();
      this.engine = new ReaderEngine(filePath, baseName, built.text, {
        ...baseOpts,
        prebuiltChapters: built.chapters,
        bookTitle: parsed.title,
      });
    } else {
      const r = await readBook(filePath, this.cfg.encoding);
      usedEnc = r.encoding;
      byteSize = r.byteSize;
      this.engine = new ReaderEngine(filePath, baseName, r.text, baseOpts);
    }
    this.engine.restorePosition(position);

    const rec: BookRecord = {
      id: this.engine.meta.id,
      path: filePath,
      title: this.engine.meta.title,
      totalChapters: this.engine.meta.totalChapters,
      totalChars: this.engine.meta.totalChars,
      position,
      lastReadAt: Date.now(),
      bookmarks: this.state.getBook(this.engine.meta.id)?.bookmarks ?? [],
    };
    this.state.upsertBook(rec);
    this.hooks.onBooksChanged?.();

    this.ui.setBookTitle(this.engine.meta.title);
    return { usedEnc, byteSize };
  }

  private async cmdInit(rawPath: string) {
    const p = rawPath.trim().replace(/^["']|["']$/g, '');
    if (!p) {
      this.enqueue(async () => this.ui.staticText(undefined, '用法:/init <txt 文件路径 或 网址>', false));
      return;
    }
    // A URL → web-novel flow (auto-detect / manual record).
    if (/^https?:\/\//i.test(p)) {
      this.cmdInitWeb(p);
      return;
    }
    try {
      const { usedEnc, byteSize } = await this.loadBook(p, 0);
      const eng = this.engine!;
      this.enqueue(() => this.ui.thinking(initThinkingLog(byteSize, usedEnc, eng.meta.totalChapters)));
      this.enqueue(async () =>
        this.ui.staticText(
          undefined,
          `书名: **${eng.meta.title}**\n` +
            `章节: ${eng.meta.totalChapters} 章 · 字数: ${eng.meta.totalChars.toLocaleString()}\n` +
            `解析完成 ✓\n\n` +
            '```\n/目录       查看章节列表\n/下一页     下一章(整章输出)\n/上一页     上一章\n/跳转 N     跳到第 N 章\n/搜索 X     全文搜索\n```',
          true
        )
      );
      this.cmdNext();
    } catch (e: any) {
      this.enqueue(async () =>
        this.ui.staticText(undefined, `解析失败:${e?.message ?? e}`, false)
      );
    }
  }

  // ---------- /init <url> : web-novel reading ----------

  /** Entry for a URL. Known host → read straight away; else offer auto / manual. */
  private cmdInitWeb(url: string) {
    if (getRuleForUrl(url)) {
      // Seen this site before → its rule already works, just read.
      void this.webOpen(url);
      return;
    }
    this.enqueue(async () =>
      this.ui.actions('这是一个网址,怎么解析?', [
        { label: '🔍 自动识别', onClick: () => void this.webOpen(url, { auto: true }) },
        { label: '✋ 手动识别', onClick: () => this.webManualRecord(url) },
      ])
    );
  }

  /** Fetch + extract + render a web chapter, set up the session for navigation. */
  private async webOpen(url: string, opts: { auto?: boolean } = {}) {
    const rule = getRuleForUrl(url);
    this.enqueue(() => this.ui.thinking(['正在抓取网页…', '提取正文与翻页…']));
    let page;
    try {
      page = await fetchUrl(url);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.includes('challenge:cloudflare')) {
        this.enqueue(async () =>
          this.ui.staticText(
            undefined,
            '这个站有「人机验证(Cloudflare)」,纯抓取过不去。\n该能力(隐藏浏览器过验证)在后续版本支持。',
            false
          )
        );
      } else {
        this.enqueue(async () => this.ui.staticText(undefined, `抓取失败:${msg}`, false));
      }
      return;
    }

    const ch = extractChapter(page.html, page.finalUrl, rule);
    if (!ch.paragraphs.length) {
      this.enqueue(async () =>
        this.ui.actions(`没能从这个页面提取到正文(${ch.reason})。`, [
          { label: '✋ 手动识别', onClick: () => this.webManualRecord(page!.finalUrl) },
        ])
      );
      return;
    }

    // Identify the novel (stable across chapters) → a library record.
    const host = hostOf(page.finalUrl);
    const key = webBookKey(page.finalUrl, ch.tocUrl);
    const id = bookId(key);

    // Enter web mode (drop any local book).
    this.engine = undefined;
    this.web = {
      bookId: id,
      host,
      url: page.finalUrl,
      title: ch.title,
      nextUrl: ch.nextUrl,
      prevUrl: ch.prevUrl,
      tocUrl: ch.tocUrl,
    };
    this.ui.setBookTitle(ch.bookTitle || ch.title);

    // Upsert the 历史会话 entry so the web novel shows up in the library and
    // reopening resumes at the last-read chapter.
    const existing = this.state.getBook(id);
    const rec: BookRecord = {
      id,
      path: key,
      title: ch.bookTitle || existing?.title || ch.title,
      totalChapters: existing?.totalChapters ?? 0,
      totalChars: 0,
      position: 0,
      lastReadAt: Date.now(),
      bookmarks: existing?.bookmarks ?? [],
      hidden: existing?.hidden,
      web: { currentUrl: page.finalUrl, tocUrl: ch.tocUrl, tocCached: existing?.web?.tocCached },
    };
    this.state.upsertBook(rec);
    this.hooks.onBooksChanged?.();

    this.renderWebChapter(ch);

    // Remember the site so next time we skip the chooser and read directly.
    if (opts.auto && ch.confidence >= 0.5 && host) {
      saveRule({ host });
    }

    // Fetch + cache the 目录 once per book (background; updates chapter count).
    if (ch.tocUrl && !rec.web?.tocCached) {
      void this.cacheWebToc(id, ch.tocUrl);
    }

    // Low confidence → tell the user and offer to teach it (per the spec).
    if (ch.confidence < 0.5) {
      this.enqueue(async () =>
        this.ui.actions(`自动识别可能不准(${ch.reason})。如果读着不对,可以手动校正:`, [
          { label: '✋ 转手动识别', onClick: () => this.webManualRecord(this.web?.url ?? url) },
        ])
      );
    }
  }

  /** Navigate the web session to the next/prev chapter. */
  private async webGo(dir: 'next' | 'prev') {
    const sess = this.web;
    if (!sess) return;
    const target = dir === 'next' ? sess.nextUrl : sess.prevUrl;
    if (!target) {
      this.enqueue(async () =>
        this.ui.streamText(undefined, dir === 'next' ? '已经是最后一章了。' : '已经是第一章了。')
      );
      return;
    }
    await this.webOpen(target);
  }

  /** Show the 目录: cached chapter list if available, else fetch (+cache). */
  private async webToc() {
    const sess = this.web;
    if (!sess) return;

    const cached = getCachedToc(sess.bookId);
    if (cached?.length) {
      this.enqueue(async () =>
        this.ui.webToc(
          '目录',
          cached.map((c) => ({ title: c.title, onClick: () => void this.webOpen(c.url) }))
        )
      );
      return;
    }

    if (!sess.tocUrl) {
      this.enqueue(async () => this.ui.staticText(undefined, '这个站没识别到「目录」链接。', false));
      return;
    }
    this.enqueue(() => this.ui.thinking(['正在抓取目录…']));
    try {
      const page = await fetchUrl(sess.tocUrl);
      const toc = extractToc(page.html, page.finalUrl, getRuleForUrl(sess.tocUrl));
      if (!toc.chapters.length) {
        this.enqueue(async () => this.ui.staticText(undefined, '没能解析出章节列表。', false));
        return;
      }
      setCachedToc(sess.bookId, toc.chapters);
      this.markTocCached(sess.bookId, toc.chapters.length);
      this.enqueue(async () =>
        this.ui.webToc(
          toc.title,
          toc.chapters.map((c) => ({ title: c.title, onClick: () => void this.webOpen(c.url) }))
        )
      );
    } catch (e: any) {
      this.enqueue(async () =>
        this.ui.staticText(undefined, `抓取目录失败:${e?.message ?? e}`, false)
      );
    }
  }

  /** Background: fetch + cache the 目录 once per book; update chapter count. */
  private async cacheWebToc(id: string, tocUrl: string) {
    try {
      const page = await fetchUrl(tocUrl);
      const toc = extractToc(page.html, page.finalUrl, getRuleForUrl(tocUrl));
      if (!toc.chapters.length) return;
      setCachedToc(id, toc.chapters);
      this.markTocCached(id, toc.chapters.length);
    } catch {
      /* best-effort; 目录 can still be fetched on demand later */
    }
  }

  private markTocCached(id: string, total: number) {
    const rec = this.state.getBook(id);
    if (!rec) return;
    this.state.upsertBook({
      ...rec,
      totalChapters: total,
      web: { ...(rec.web ?? { currentUrl: '' }), tocCached: true },
    });
    this.hooks.onBooksChanged?.();
  }

  /** Render a fetched web chapter through the normal chapter pipeline. */
  private renderWebChapter(ch: WebChapter) {
    const mk = (text: string, atStart: boolean): Segment => {
      const meta: PageMeta = {
        chapterIndex: 0,
        chapterTitle: ch.title,
        pageInChapter: 0,
        pagesInChapter: 1,
        charOffset: 0,
        atChapterStart: atStart,
      };
      return { text, meta, startOffset: 0, endOffset: 0, done: false };
    };
    const segs: Segment[] = [mk('', true), ...ch.paragraphs.map((p) => mk(p, false))];
    this.emitChapter(segs);
  }

  /** Manual-record (teach-by-clicking) — scaffolded; full wizard next increment. */
  private webManualRecord(url: string) {
    this.enqueue(async () =>
      this.ui.staticText(
        undefined,
        '手动识别(在网页上分步点选 正文 / 上一页 / 下一页 / 目录,录成本站规则)' +
          `即将上线。\n目标页:${url}`,
        false
      )
    );
  }

  // ---------- reading ----------
  private requireBook(): ReaderEngine | undefined {
    if (!this.engine) {
      this.enqueue(async () =>
        this.ui.staticText(undefined, '还没有打开的书。先用 /init <路径> 关联一本。', false)
      );
      return undefined;
    }
    return this.engine;
  }

  cmdNext() {
    if (this.web) {
      this.webGo('next');
      return;
    }
    const eng = this.requireBook();
    if (!eng) return;
    const res = eng.nextChapter();
    if (res.done) {
      this.enqueue(async () => this.ui.streamText(undefined, '已经到全书末尾了 ✓'));
      return;
    }
    this.state.setPosition(eng.meta.id, res.segments[0].startOffset);
    this.emitChapter(res.segments);
  }

  cmdPrev() {
    if (this.web) {
      this.webGo('prev');
      return;
    }
    const eng = this.requireBook();
    if (!eng) return;
    const res = eng.prevChapter();
    if (res.done) {
      this.enqueue(async () => this.ui.streamText(undefined, '已经是开头了。'));
      return;
    }
    this.state.setPosition(eng.meta.id, res.segments[0].startOffset);
    this.emitChapter(res.segments);
  }

  /** Render a whole chapter: paragraphs instant, disguise inserts woven between. */
  private emitChapter(segments: Segment[]) {
    const insertsEnabled = this.cfg.fakeDiffEnabled;
    const freq = this.cfg.fakeDiffFrequency;
    const prof = resolveProfession(this.cfg);
    this.enqueue(async () => this.ui.markAnchor());
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      this.enqueue(async () => this.ui.paragraph(seg.text, seg.meta, []));

      const isLast = i === segments.length - 1;
      if (insertsEnabled && !seg.meta.atChapterStart && !isLast && Math.random() < freq) {
        const ins = pickReadingInsert(prof);
        if (ins) this.enqueue(async () => this.ui.disguiseInsert(ins.label, ins.note, ins.block));
      }
    }
    this.enqueue(async () => this.ui.pinAnchor());
    this.hooks.onBooksChanged?.();
  }

  // ---------- /目录 ----------
  /** Chapter list + current index for the 目录 panel (host renders it). */
  getToc(): { chapters: { index: number; title: string }[]; current: number } | undefined {
    if (!this.engine) return undefined;
    return {
      chapters: this.engine.chapters.map((c) => ({ index: c.index, title: c.title })),
      current: this.engine.currentChapterIndex(),
    };
  }

  /** Jump to a chapter (1-based) from the 目录 panel, no command echo. */
  jumpChapter(oneBased: number) {
    const eng = this.requireBook();
    if (!eng) return;
    const res = eng.jumpToChapter(oneBased);
    if (res.done || !res.segments.length) {
      this.enqueue(async () => this.ui.staticText(undefined, '该章节为空或不存在。', false));
      return;
    }
    this.state.setPosition(eng.meta.id, res.segments[0].startOffset);
    this.emitChapter(res.segments);
  }

  private cmdToc() {
    if (this.web) {
      this.webToc();
      return;
    }
    if (!this.engine) {
      this.enqueue(async () =>
        this.ui.staticText(undefined, '还没有打开的书。先用 /init <路径> 关联一本。', false)
      );
      return;
    }
    this.hooks.onToc?.();
  }

  // ---------- /跳转 ----------
  private cmdJump(args: string) {
    const eng = this.requireBook();
    if (!eng) return;
    const n = parseInt(args.trim(), 10);
    if (isNaN(n)) {
      this.enqueue(async () =>
        this.ui.staticText(undefined, '用法:/跳转 <章节号>,例如 /跳转 3', false)
      );
      return;
    }
    const res = eng.jumpToChapter(n);
    if (res.done || !res.segments.length) {
      this.enqueue(async () => this.ui.staticText(undefined, '该章节为空或不存在。', false));
      return;
    }
    this.state.setPosition(eng.meta.id, res.segments[0].startOffset);
    this.emitChapter(res.segments);
  }

  // ---------- /搜索 ----------
  private cmdSearch(args: string) {
    const eng = this.requireBook();
    if (!eng) return;
    const q = args.trim();
    if (!q) {
      this.enqueue(async () => this.ui.staticText(undefined, '用法:/搜索 <关键词>', false));
      return;
    }
    const results = eng.search(q);
    this.enqueue(async () => this.ui.search(q, results));
  }

  // ---------- /书签 ----------
  private cmdBookmark(args: string) {
    const eng = this.requireBook();
    if (!eng) return;
    const [sub, ...rest] = args.trim().split(/\s+/);
    const restText = rest.join(' ').trim();
    const rec = this.state.getBook(eng.meta.id);
    const bms = rec?.bookmarks ?? [];

    if (sub === 'add' || sub === '' || sub === undefined) {
      const ch = eng.currentChapter();
      const label = restText || (ch ? ch.title : `位置 ${eng.position}`);
      const offset = ch ? ch.startOffset : eng.position;
      this.state.addBookmark(eng.meta.id, { offset, label, createdAt: Date.now() });
      this.enqueue(async () => this.ui.streamText(undefined, `已添加书签:${label}`));
    } else if (sub === 'list') {
      if (!bms.length) {
        this.enqueue(async () =>
          this.ui.staticText(undefined, '暂无书签。用 /书签 add [名称] 添加。', false)
        );
        return;
      }
      const lines = bms.map((b, i) => `${i + 1}. ${b.label}`).join('\n');
      this.enqueue(async () =>
        this.ui.staticText(
          undefined,
          '书签列表:\n```\n' + lines + '\n```\n用 /书签 jump <序号或名称> 跳转。',
          true
        )
      );
    } else if (sub === 'jump') {
      if (!bms.length) {
        this.enqueue(async () => this.ui.staticText(undefined, '暂无书签。用 /书签 add 添加。', false));
        return;
      }
      const n = parseInt(restText, 10);
      let bm = !isNaN(n) && n >= 1 && n <= bms.length ? bms[n - 1] : undefined;
      if (!bm) bm = bms.find((b) => b.label === restText);
      if (!bm) {
        this.enqueue(async () =>
          this.ui.staticText(undefined, `没找到书签「${restText}」。用 /书签 list 查看。`, false)
        );
        return;
      }
      const target = bm;
      const res = eng.jumpToOffset(target.offset);
      if (res.segments.length) {
        this.state.setPosition(eng.meta.id, res.segments[0].startOffset);
        this.enqueue(async () => this.ui.streamText(undefined, `↩ 跳到书签:${target.label}`));
        this.emitChapter(res.segments);
      }
    } else {
      this.enqueue(async () =>
        this.ui.staticText(undefined, '用法:/书签 [add 名称 | list | jump 序号/名称]', false)
      );
    }
  }

  // ---------- /历史 ----------
  private cmdHistory(args: string) {
    const books = this.state.getBooks().slice().sort((a, b) => b.lastReadAt - a.lastReadAt);
    if (!books.length) {
      this.enqueue(async () => this.ui.staticText(undefined, '还没有阅读记录。', false));
      return;
    }
    const n = parseInt(args.trim(), 10);
    if (!isNaN(n)) {
      const target = books[n - 1];
      if (!target) {
        this.enqueue(async () => this.ui.staticText(undefined, '无效的编号。', false));
        return;
      }
      void this.switchBook(target);
      return;
    }
    const lines = books
      .map((b, i) => `${i + 1}. ${b.title}  (${b.totalChapters}章 · 上次 offset ${b.position})`)
      .join('\n');
    this.enqueue(async () =>
      this.ui.staticText(undefined, '最近阅读:\n```\n' + lines + '\n```\n用 /历史 N 切换。', true)
    );
  }

  private async switchBook(rec: BookRecord) {
    try {
      await this.loadBook(rec.path, rec.position);
      this.enqueue(async () => this.ui.streamText(undefined, `已切换到《${rec.title}》`));
      this.cmdNext();
    } catch {
      this.enqueue(async () => this.ui.staticText(undefined, `无法打开:${rec.path}`, false));
    }
  }

  // ---------- /设置 ----------
  private cmdSettings() {
    const c = this.cfg;
    const summary =
      '当前设置:\n```\n' +
      `每页字数      ${c.charsPerPage}\n` +
      `编码          ${c.encoding}\n` +
      `流式速度      ${c.fakeThinkingSpeed}\n` +
      `假 diff       ${c.fakeDiffEnabled ? '开' : '关'} (概率 ${c.fakeDiffFrequency})\n` +
      `老板键触发    ${c.bossTriggers.join(', ') || '仅手动'}\n` +
      `老板键动作    ${c.bossAction}\n` +
      `失焦延迟      ${c.bossBlurDelay}ms\n` +
      `离开延迟      ${c.bossMouseLeaveDelay}ms\n` +
      '```\n配置保存在本地。后续版本将提供图形化设置面板。';
    this.enqueue(async () => this.ui.staticText(undefined, summary, true));
  }

  // ---------- /help ----------
  private cmdHelp() {
    const lines = COMMANDS.map((c) => {
      const names = [c.name, ...c.aliases].join(' / ');
      const hint = c.paramHint ? ' ' + c.paramHint : '';
      return `${names}${hint}\n    ${c.description}`;
    }).join('\n');
    this.enqueue(async () =>
      this.ui.staticText(undefined, '可用命令:\n```\n' + lines + '\n```', true)
    );
  }

  // ---------- boss mode ----------
  toggleBoss(trigger: BossTrigger) {
    if (this.bossActive) this.exitBoss();
    else this.enterBoss(trigger);
  }

  enterBoss(trigger: BossTrigger) {
    if (this.bossActive) return;
    if (this.mouseLeaveTimer) {
      clearTimeout(this.mouseLeaveTimer);
      this.mouseLeaveTimer = undefined;
    }
    this.bossActive = true;
    this.bossTrigger = trigger;
    this.bossSavedPosition = this.engine?.position ?? 0;

    // Window-level disguise (minimize / hide) instead of a fake conversation.
    if (this.cfg.bossAction === 'minimize') {
      void bossWindow('minimize');
      return;
    }
    if (this.cfg.bossAction === 'hide') {
      void bossWindow('hide');
      return;
    }

    // Default: render a preset "working" Q&A conversation.
    // Highlight the currently-open book's row as the active 历史对话 (if any).
    this.bossSelectedId = this.currentBookId();
    this.hooks.hardReset();
    this.hooks.onBossChange?.(true);
    this.emitBossTurns(Math.max(1, this.cfg.bossFakeConversationCount));
  }

  private emitBossTurns(n: number) {
    this.renderBossTurns(nextBossTurns(resolveProfession(this.cfg), n));
  }

  /** Render the stable, distinct fake conversation for a given 历史对话 row id. */
  private emitBossConversationFor(id: string) {
    const prof = resolveProfession(this.cfg);
    const n = Math.max(1, this.cfg.bossFakeConversationCount);
    this.renderBossTurns(bossTurnsForKey(prof, id, n));
  }

  private renderBossTurns(turns: ReturnType<typeof nextBossTurns>) {
    for (const t of turns) {
      this.enqueue(async () => this.ui.user(t.prompt));
      this.enqueue(() => this.ui.thinking(t.thinking));
      this.enqueue(() => this.ui.streamText(undefined, t.answer));
      if (t.insert) {
        const ins = t.insert;
        this.enqueue(async () => {
          const { turn } = this.ui.beginAssistant(ins.label);
          await this.ui.renderInsert(turn, ins.block, false);
        });
      }
    }
  }

  exitBoss() {
    if (!this.bossActive) return;
    this.bossActive = false;
    this.bossTrigger = undefined;
    this.bossSelectedId = undefined;

    if (this.cfg.bossAction === 'minimize' || this.cfg.bossAction === 'hide') {
      void bossWindow('show');
      return;
    }

    this.hooks.hardReset();
    this.hooks.onBossChange?.(false);
    if (this.engine) {
      const segments = this.engine.lastChapterSegments();
      if (segments.length) {
        this.enqueue(async () => this.ui.streamText(undefined, '— 已恢复阅读 —'));
        this.emitChapter(segments);
      } else {
        this.enqueue(async () =>
          this.ui.streamText(undefined, '已恢复摸鱼态 · 输入 /next 继续')
        );
      }
    }
  }

  // ---------- passive triggers ----------
  private triggerEnabled(name: 'blur' | 'mouseLeave'): boolean {
    return this.cfg.bossTriggers.includes(name);
  }

  private get autoExit(): boolean {
    return this.cfg.bossAutoExit;
  }

  onMouseLeave() {
    if (this.bossActive || !this.triggerEnabled('mouseLeave')) return;
    const delay = Math.max(0, this.cfg.bossMouseLeaveDelay);
    if (this.mouseLeaveTimer) clearTimeout(this.mouseLeaveTimer);
    this.mouseLeaveTimer = setTimeout(() => {
      this.mouseLeaveTimer = undefined;
      if (!this.bossActive) this.enterBoss('mouseLeave');
    }, delay);
  }

  onMouseEnter() {
    if (this.mouseLeaveTimer) {
      clearTimeout(this.mouseLeaveTimer);
      this.mouseLeaveTimer = undefined;
    }
    if (this.autoExit && this.bossActive && this.bossTrigger === 'mouseLeave') {
      this.exitBoss();
    }
  }

  onWindowBlur() {
    if (this.bossActive || !this.triggerEnabled('blur')) return;
    this.enterBoss('blur');
  }

  onWindowFocus() {
    if (this.autoExit && this.bossActive && this.bossTrigger === 'blur') {
      this.exitBoss();
    }
  }
}
