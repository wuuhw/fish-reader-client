import { StateStore } from '../engine/state';
import { el } from './dom';

export interface SidebarHooks {
  onOpenBook: (id: string) => void;
  onDeleteBook: (id: string) => void;
  onHideBook: (id: string) => void;
  isBoss: () => boolean;
  currentBookId: () => string | undefined;
  /** Profession-specific fake 历史对话 title for boss mode (by row index). */
  fakeName: (index: number) => string;
}

/** Owns the left sidebar: fake skills + the 历史对话 (book library) list. */
export class Sidebar {
  private listEl: HTMLElement;
  private boss = false;
  private openMenu?: HTMLElement;
  /** Stable display order of book ids; only rebuilt by reorder(). */
  private order: string[] = [];

  constructor(
    private state: StateStore,
    private hooks: SidebarHooks
  ) {
    this.listEl = document.getElementById('history-list')!;
    this.wireSkills();
    document.addEventListener('click', () => this.closeMenu());
  }

  /** Decorative skill rows: selecting one just moves the highlight. */
  private wireSkills() {
    const skills = document.querySelectorAll<HTMLElement>('.sb-skill:not(.sb-collapse)');
    skills.forEach((s) => {
      s.addEventListener('click', () => {
        skills.forEach((x) => x.classList.remove('selected'));
        s.classList.add('selected');
      });
    });
    // 收起 folds the 历史对话 list.
    const collapse = document.getElementById('hist-collapse');
    collapse?.addEventListener('click', () => {
      const collapsed = this.listEl.classList.toggle('collapsed');
      collapse.classList.toggle('is-collapsed', collapsed);
    });
  }

  setBoss(active: boolean) {
    this.boss = active;
    this.refresh();
  }

  /**
   * Rebuild the stable display order from scratch (sorted by last-read).
   * Called only on app start and after a hide/show — NOT on every open, so
   * the list doesn't reshuffle while you read.
   */
  reorder() {
    this.order = this.state.visibleBooks().map((b) => b.id);
  }

  /**
   * Re-render the history list. Keeps the existing order; new books appear on
   * top, removed/hidden books drop out — but already-listed books stay put.
   */
  refresh() {
    const books = this.state.visibleBooks();
    const byId = new Map(books.map((b) => [b.id, b]));
    // Drop ids that are no longer visible.
    this.order = this.order.filter((id) => byId.has(id));
    // New books (e.g. just opened a fresh txt) go to the top.
    for (const b of books) if (!this.order.includes(b.id)) this.order.unshift(b.id);

    const ordered = this.order.map((id) => byId.get(id)!).filter(Boolean);
    const currentId = this.hooks.currentBookId();
    this.listEl.textContent = '';

    if (!ordered.length) {
      this.listEl.appendChild(
        el('div', 'hist-empty', '还没有阅读记录。\n点「新对话」打开一本 txt。')
      );
      return;
    }

    ordered.forEach((b, i) => {
      const item = el('div', 'hist-item' + (b.id === currentId ? ' active' : ''));
      item.dataset.id = b.id;
      item.appendChild(el('span', 'hist-ic', '💬'));
      const title = el('span', 'hist-title', this.boss ? this.hooks.fakeName(i) : b.title);
      item.appendChild(title);

      // The ⋯ menu (delete / hide) is hidden while disguising.
      if (!this.boss) {
        const more = el('button', 'hist-more', '⋯');
        more.addEventListener('click', (e) => {
          e.stopPropagation();
          this.showMenu(item, b.id);
        });
        item.appendChild(more);
      }

      item.addEventListener('click', () => this.hooks.onOpenBook(b.id));
      this.listEl.appendChild(item);
    });
  }

  private showMenu(anchor: HTMLElement, id: string) {
    this.closeMenu();
    const menu = el('div', 'hist-menu');
    const hide = el('div', 'hist-menu-item', '隐藏');
    hide.prepend(el('span', undefined, '🙈'));
    hide.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeMenu();
      this.hooks.onHideBook(id);
    });
    const del = el('div', 'hist-menu-item danger', '删除');
    del.prepend(el('span', undefined, '🗑'));
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeMenu();
      this.hooks.onDeleteBook(id);
    });
    menu.appendChild(hide);
    menu.appendChild(del);

    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${rect.left + 12}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    document.body.appendChild(menu);
    this.openMenu = menu;
  }

  private closeMenu() {
    if (this.openMenu) {
      this.openMenu.remove();
      this.openMenu = undefined;
    }
  }
}
