import { el } from './dom';
import { UpdateInfo, runUpdate } from '../updater';

/** Human-readable byte size. */
function fmtBytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
}

/**
 * Renders the two update affordances:
 *  - forced(): a cold-start mandatory modal — no close, no skip, only 立即更新.
 *  - badgePrompt(): a red indicator in the header; clicking opens a dismissible
 *    modal (still offering 立即更新, but the user may defer).
 */
export class UpdatePrompt {
  private head: HTMLElement;
  private badge?: HTMLElement;
  private latest?: UpdateInfo;
  private modalOpen = false;

  constructor() {
    this.head = document.getElementById('main-head')!;
  }

  /** Cold-start: an update was found before the user did anything — force it. */
  forced(info: UpdateInfo) {
    this.openModal(info, true);
  }

  /** Running app: surface a low-key red badge; details on click, deferrable. */
  badgePrompt(info: UpdateInfo) {
    this.latest = info;
    if (this.badge) return; // badge already visible
    const b = el('button', 'update-badge');
    b.title = `发现新版本 ${info.version}，点击查看`;
    b.appendChild(el('span', 'update-badge-dot'));
    b.appendChild(el('span', 'update-badge-text', '有新版本'));
    b.addEventListener('click', () => this.latest && this.openModal(this.latest, false));
    this.head.appendChild(b);
    this.badge = b;
  }

  private openModal(info: UpdateInfo, forced: boolean) {
    if (this.modalOpen) return;
    this.modalOpen = true;

    const overlay = el('div', 'update-overlay' + (forced ? ' forced' : ''));
    const close = () => {
      overlay.remove();
      this.modalOpen = false;
    };
    if (!forced) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
      });
    }

    const modal = el('div', 'update-modal');

    const head = el('div', 'update-head');
    head.appendChild(el('span', 'update-title', `发现新版本 ${info.version}`));
    if (!forced) {
      const x = el('button', 'icon-btn', '✕');
      x.addEventListener('click', close);
      head.appendChild(x);
    }
    modal.appendChild(head);

    modal.appendChild(
      el('div', 'update-ver', `当前 v${info.currentVersion}  →  新版 v${info.version}`)
    );

    const notes = el('div', 'update-notes');
    (info.notes || '本次更新包含若干改进与修复。').split('\n').forEach((line, i) => {
      if (i > 0) notes.appendChild(document.createElement('br'));
      notes.appendChild(document.createTextNode(line));
    });
    modal.appendChild(notes);

    const progress = el('div', 'update-progress hidden');
    const bar = el('div', 'update-progress-bar');
    progress.appendChild(bar);
    modal.appendChild(progress);
    const pct = el('div', 'update-progress-text');
    modal.appendChild(pct);

    const actions = el('div', 'update-actions');
    const go = el('button', 'update-go-btn', '立即更新');
    actions.appendChild(go);
    modal.appendChild(actions);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    go.addEventListener('click', async () => {
      go.disabled = true;
      go.textContent = '正在下载…';
      progress.classList.remove('hidden');
      try {
        await runUpdate((frac, downloaded, total) => {
          if (frac < 0) {
            bar.classList.add('indeterminate');
            bar.style.width = '100%';
            pct.textContent = `已下载 ${fmtBytes(downloaded)}`;
          } else {
            bar.classList.remove('indeterminate');
            bar.style.width = `${Math.round(frac * 100)}%`;
            pct.textContent = `${Math.round(frac * 100)}%  ·  ${fmtBytes(downloaded)} / ${fmtBytes(total)}`;
          }
        });
        // runUpdate() relaunches on success; reaching here means it's restarting.
        go.textContent = '即将重启…';
        pct.textContent = '更新完成，正在重启';
      } catch (e) {
        console.error('[updater] install failed', e);
        go.disabled = false;
        go.textContent = '重试';
        pct.textContent = '更新失败，请检查网络后重试';
      }
    });
  }
}
