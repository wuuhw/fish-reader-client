import { el } from './dom';
import { BRAND, APP_VERSION, FOLLOW_PITCH } from '../brand';
import { openExternal } from '../tauri';
import { showToast } from './toast';

/** Copy the 抖音 number to clipboard and toast (抖音 has no web profile to open). */
async function copyDouyin() {
  try {
    await navigator.clipboard.writeText(BRAND.douyinId);
    showToast(`抖音号 ${BRAND.douyinId} 已复制,去抖音搜索添加我吧～`);
  } catch {
    showToast(`抖音号:${BRAND.douyinId}(请手动复制)`);
  }
}

/**
 * The three "关注/外链" buttons (官网 / GitHub / 抖音). Reused by:
 *  - the Settings 关于 section
 *  - the first-run onboarding "关注作者" step
 *  - the discreet header ℹ️ about modal
 * 官网/GitHub open in the system browser; 抖音 copies the number + toasts.
 */
export function buildFollowLinks(): HTMLElement {
  const wrap = el('div', 'follow-links');

  const site = el('button', 'follow-link');
  site.appendChild(el('span', 'follow-link-ic', '🌐'));
  site.appendChild(el('span', 'follow-link-label', '官网'));
  site.addEventListener('click', () => void openExternal(BRAND.site));
  wrap.appendChild(site);

  const gh = el('button', 'follow-link');
  gh.appendChild(el('span', 'follow-link-ic', '⭐'));
  gh.appendChild(el('span', 'follow-link-label', 'GitHub'));
  gh.addEventListener('click', () => void openExternal(BRAND.github));
  wrap.appendChild(gh);

  const dy = el('button', 'follow-link');
  dy.appendChild(el('span', 'follow-link-ic', '🎵'));
  dy.appendChild(el('span', 'follow-link-label', '关注抖音'));
  dy.addEventListener('click', () => void copyDouyin());
  wrap.appendChild(dy);

  return wrap;
}

/** The "关于" block: brand + version + pitch + follow links. */
export function buildAboutBlock(): HTMLElement {
  const box = el('div', 'about-block');
  const head = el('div', 'about-head');
  head.appendChild(el('span', 'about-name', BRAND.name));
  head.appendChild(el('span', 'about-ver', `v${APP_VERSION}`));
  box.appendChild(head);
  box.appendChild(el('div', 'about-pitch', FOLLOW_PITCH));
  box.appendChild(buildFollowLinks());
  return box;
}

/** Standalone about modal — opened by the discreet header ℹ️ entry. */
export function openAboutModal(): void {
  const overlay = el('div', 'settings-overlay');
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  const modal = el('div', 'about-modal');
  const head = el('div', 'settings-head');
  head.appendChild(el('span', 'settings-title', '关于'));
  const x = el('button', 'icon-btn', '✕');
  x.addEventListener('click', close);
  head.appendChild(x);
  modal.appendChild(head);

  const body = el('div', 'about-modal-body');
  body.appendChild(buildAboutBlock());
  modal.appendChild(body);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}
