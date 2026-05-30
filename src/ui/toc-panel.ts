import { el } from './dom';

export interface TocData {
  chapters: { index: number; title: string }[];
  current: number;
}

/**
 * A toggleable 目录 drawer docked inside the main area (NOT a full-screen
 * overlay) — so opening it never makes the pointer "leave" #app and never
 * trips the mouse-leave boss trigger. Locates the current chapter on open.
 */
export class TocPanel {
  private drawer?: HTMLElement;

  constructor(
    private mount: HTMLElement,
    private getData: () => TocData | undefined,
    private onJump: (oneBased: number) => void
  ) {}

  isOpen(): boolean {
    return !!this.drawer;
  }

  /** 目录 button: open if closed, close if already open. */
  toggle() {
    if (this.drawer) this.close();
    else this.open();
  }

  close() {
    this.drawer?.remove();
    this.drawer = undefined;
  }

  open() {
    this.close();
    const data = this.getData();

    const drawer = el('div', 'toc-drawer');

    const head = el('div', 'toc-panel-head');
    head.appendChild(el('span', 'toc-panel-title', '目录'));
    const close = el('button', 'icon-btn', '✕');
    close.addEventListener('click', () => this.close());
    head.appendChild(close);
    drawer.appendChild(head);

    const list = el('div', 'toc-panel-list');
    if (!data || !data.chapters.length) {
      list.appendChild(el('div', 'toc-panel-empty', '还没有打开的书。'));
    } else {
      data.chapters.forEach((c) => {
        const item = el('div', 'toc-panel-item' + (c.index === data.current ? ' current' : ''));
        item.textContent = `${c.index + 1}. ${c.title}`;
        item.addEventListener('click', () => {
          this.onJump(c.index + 1);
          this.close();
        });
        list.appendChild(item);
      });
    }
    drawer.appendChild(list);

    this.mount.appendChild(drawer);
    this.drawer = drawer;

    // Locate the current chapter.
    const cur = list.querySelector('.toc-panel-item.current') as HTMLElement | null;
    cur?.scrollIntoView({ block: 'center' });
  }
}
