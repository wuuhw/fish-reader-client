import './styles.css';
import { CommandSpec } from './types';
import { UI } from './ui/dom';
import { Sidebar } from './ui/sidebar';
import { TocPanel } from './ui/toc-panel';
import { setSpeed, bumpEpoch } from './ui/streaming';
import { matchCommands } from './commands/registry';
import { StateStore } from './engine/state';
import { Controller } from './controller';
import { SettingsPanel } from './ui/settings';
import { loadConfig, saveConfig, AppConfig } from './config';
import { resolveProfession, bossHistoryName } from './disguise/professions';
import { inTauri } from './tauri';
import { checkForUpdate } from './updater';
import { UpdatePrompt } from './ui/update-modal';

const logEl = document.getElementById('log') as HTMLElement;
const inputEl = document.getElementById('input') as HTMLTextAreaElement;
const slashMenu = document.getElementById('slash-menu') as HTMLElement;
const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;
const newChatBtn = document.getElementById('new-chat') as HTMLButtonElement;
const collapseBtn = document.getElementById('collapse-btn') as HTMLButtonElement;
const sidebarShowBtn = document.getElementById('sidebar-show') as HTMLButtonElement;
const deepThinkBtn = document.getElementById('deep-think') as HTMLButtonElement;
const bossLabelEl = document.getElementById('boss-label') as HTMLElement;
const bossIcEl = document.getElementById('boss-ic') as HTMLElement;
const appEl = document.getElementById('app') as HTMLElement;

const cfg = loadConfig();
setSpeed(cfg.fakeThinkingSpeed);

const state = new StateStore();
const ui = new UI(logEl, (raw: string) => void controller.handleInput(raw));

// ---------- sequential animation queue ----------
const queue: Array<() => Promise<void>> = [];
let running = false;
async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const task = queue.shift()!;
    try {
      await task();
    } catch (e) {
      console.error(e);
    }
  }
  running = false;
}
function enqueue(task: () => Promise<void>) {
  queue.push(task);
  void pump();
}

function hardReset() {
  bumpEpoch();
  queue.length = 0;
  ui.clear();
}

// ---------- controller + sidebar ----------
const controller = new Controller(ui, state, cfg, {
  enqueue,
  hardReset,
  onBooksChanged: () => sidebar.refresh(),
  onBossChange: (active) => {
    appEl.classList.toggle('boss-mode', active);
    tocPanel.close(); // never leave the 目录 open across a mode switch
    bossLabelEl.textContent = active ? '恢复' : 'boss';
    bossIcEl.textContent = active ? '↩' : '🫣';
    sidebar.setBoss(active);
    if (active) {
      ui.setMainTitle('AI 搜索'); // boss-mode disguise title
      selectSkill('search');
    } else {
      ui.restoreTitle();
    }
  },
  onToc: () => tocPanel.open(),
});

const tocPanel = new TocPanel(
  document.getElementById('main') as HTMLElement,
  () => controller.getToc(),
  (n) => controller.jumpChapter(n)
);

const sidebar = new Sidebar(state, {
  onOpenBook: (id) => {
    if (controller.isBoss) {
      controller.pokeBoss();
      return;
    }
    hardReset();
    void controller.openBookById(id);
    sidebar.refresh();
  },
  onDeleteBook: (id) => {
    state.removeBook(id);
    controller.forgetBookIfOpen(id);
    sidebar.refresh();
  },
  onHideBook: (id) => {
    state.setHidden(id, true);
    sidebar.reorder(); // re-sort after a hide
    sidebar.refresh();
  },
  isBoss: () => controller.isBoss,
  currentBookId: () => controller.currentBookId(),
  fakeName: (i) => bossHistoryName(resolveProfession(cfg), i),
});

function selectSkill(key: string) {
  document.querySelectorAll<HTMLElement>('.sb-skill').forEach((s) => {
    s.classList.toggle('selected', s.dataset.skill === key);
  });
}

// ---------- identity (name + avatar) + settings ----------
const brandNameEl = document.getElementById('brand-name') as HTMLElement;
const avatarEl = document.getElementById('avatar') as HTMLElement;

function applyIdentity() {
  brandNameEl.textContent = cfg.avatarName || '豆包';
  if (cfg.avatarDataUrl) {
    avatarEl.style.backgroundImage = `url(${cfg.avatarDataUrl})`;
    avatarEl.classList.add('has-img');
  } else {
    avatarEl.style.backgroundImage = '';
    avatarEl.classList.remove('has-img');
  }
}

const settings = new SettingsPanel(cfg, (next: AppConfig) => {
  Object.assign(cfg, next);
  saveConfig(cfg);
  setSpeed(cfg.fakeThinkingSpeed);
  applyIdentity();
});

document.getElementById('brand-block')?.addEventListener('click', () => settings.open());

// ---------- new chat / add book ----------
async function openAddBook() {
  if (inTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const sel = await open({
      multiple: false,
      directory: false,
      filters: [{ name: '小说', extensions: ['txt', 'epub', 'fb2'] }],
    });
    hardReset();
    if (typeof sel === 'string') void controller.handleInput(`/init ${sel}`);
    else controller.startNewSession();
    return;
  }
  hardReset();
  controller.startNewSession();
}
newChatBtn.addEventListener('click', () => void openAddBook());

// ---------- sidebar collapse ----------
collapseBtn.addEventListener('click', () => {
  appEl.classList.add('sidebar-collapsed');
  sidebarShowBtn.classList.remove('hidden');
});
sidebarShowBtn.addEventListener('click', () => {
  appEl.classList.remove('sidebar-collapsed');
  sidebarShowBtn.classList.add('hidden');
});

// ---------- deep-think toggle (decorative) ----------
deepThinkBtn.addEventListener('click', () => deepThinkBtn.classList.toggle('off'));

// ---------- reading-mode toolbar (boss key + chapter nav) ----------
document.getElementById('boss-btn')?.addEventListener('click', () => controller.toggleBoss('button'));
document.getElementById('nav-prev')?.addEventListener('click', () => controller.cmdPrev());
document.getElementById('nav-next')?.addEventListener('click', () => controller.cmdNext());
document.getElementById('nav-toc')?.addEventListener('click', () => tocPanel.toggle());

// ---------- slash menu ----------
let menuItems: CommandSpec[] = [];
let menuIndex = 0;

const RESUME_SPEC = matchCommands('/resume').find((c) => c.name === '/恢复');
function resumeSpec(): CommandSpec[] {
  return RESUME_SPEC ? [RESUME_SPEC] : [];
}

function showMenu() {
  const val = inputEl.value;
  if (!val.startsWith('/') || val.includes(' ')) {
    hideMenu();
    return;
  }
  menuItems = controller.isBoss ? resumeSpec() : matchCommands(val);
  if (!menuItems.length) {
    hideMenu();
    return;
  }
  menuIndex = 0;
  renderMenu();
  slashMenu.classList.remove('hidden');
}

function renderMenu() {
  slashMenu.textContent = '';
  const head = document.createElement('div');
  head.className = 'slash-menu-head';
  head.textContent = 'Slash Commands';
  slashMenu.appendChild(head);
  menuItems.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'slash-item' + (i === menuIndex ? ' selected' : '');
    const name = document.createElement('span');
    name.className = 'slash-name';
    name.textContent = (c.display ?? c.name) + (c.paramHint ? ' ' + c.paramHint : '');
    const desc = document.createElement('span');
    desc.className = 'slash-desc';
    desc.textContent = c.description;
    row.appendChild(name);
    row.appendChild(desc);
    row.addEventListener('mousedown', (e) => {
      e.preventDefault();
      acceptMenu(i);
    });
    slashMenu.appendChild(row);
  });
  const sel = slashMenu.querySelector('.slash-item.selected') as HTMLElement | null;
  sel?.scrollIntoView({ block: 'nearest' });
}

function hideMenu() {
  slashMenu.classList.add('hidden');
  menuItems = [];
}

function acceptMenu(i: number) {
  const c = menuItems[i];
  if (!c) return;
  inputEl.value = (c.display ?? c.name) + (c.paramHint ? ' ' : '');
  hideMenu();
  inputEl.focus();
  autoSize();
}

// ---------- command history (↑ / ↓ recall) ----------
let history: string[] = [];
try {
  const raw = localStorage.getItem('fishReader.history');
  if (raw) history = JSON.parse(raw);
} catch {
  /* ignore */
}
let histIndex = history.length;

function pushHistory(raw: string) {
  if (history[history.length - 1] !== raw) {
    history.push(raw);
    if (history.length > 100) history = history.slice(-100);
    try {
      localStorage.setItem('fishReader.history', JSON.stringify(history));
    } catch {
      /* ignore */
    }
  }
  histIndex = history.length;
}

function recall(dir: -1 | 1) {
  if (controller.isBoss) {
    inputEl.value = '/resume';
    hideMenu();
    autoSize();
    const e = inputEl.value.length;
    inputEl.setSelectionRange(e, e);
    return;
  }
  if (!history.length) return;
  histIndex = Math.max(0, Math.min(history.length, histIndex + dir));
  const value = histIndex >= history.length ? '' : history[histIndex];
  inputEl.value = value;
  hideMenu();
  autoSize();
  const end = inputEl.value.length;
  inputEl.setSelectionRange(end, end);
}

function submit() {
  const raw = inputEl.value.trim();
  if (!raw) return;
  void controller.handleInput(raw);
  pushHistory(raw);
  inputEl.value = '';
  hideMenu();
  autoSize();
}

function autoSize() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(140, inputEl.scrollHeight) + 'px';
}

inputEl.addEventListener('input', () => {
  histIndex = history.length;
  showMenu();
  autoSize();
});

inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
  const menuOpen = !slashMenu.classList.contains('hidden');
  if (menuOpen) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      menuIndex = (menuIndex + 1) % menuItems.length;
      renderMenu();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      menuIndex = (menuIndex - 1 + menuItems.length) % menuItems.length;
      renderMenu();
      return;
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && menuItems.length)) {
      e.preventDefault();
      acceptMenu(menuIndex);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hideMenu();
      return;
    }
  } else {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      recall(-1);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      recall(1);
      return;
    }
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submit();
  }
});

sendBtn.addEventListener('click', () => {
  submit();
  inputEl.focus();
});

// ---------- boss hotkey: Cmd/Ctrl+Shift+B ----------
// Inside Tauri we register a real OS-level global shortcut (reliable, not
// swallowed by the webview). This flag suppresses the in-page fallback so the
// key isn't handled twice (which would toggle on+off = no-op).
let bossHotkeyViaGlobal = false;

window.addEventListener('keydown', (e: KeyboardEvent) => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'b' || e.key === 'B')) {
    e.preventDefault();
    if (!bossHotkeyViaGlobal) controller.toggleBoss('hotkey');
  }
  // ⌘K / Ctrl+K → new chat (matches the sidebar hint)
  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    void openAddBook();
  }
});

// ---------- mouse-leave auto boss ----------
// An open overlay (目录 / 设置 / 历史右键菜单) sits above #app, so the pointer
// moving onto it fires #app's mouseleave — that must NOT arm the boss timer.
function overlayOpen(): boolean {
  return !!document.querySelector('.toc-overlay, .settings-overlay, .hist-menu');
}
appEl.addEventListener('mouseleave', () => {
  if (overlayOpen()) return;
  controller.onMouseLeave();
});
appEl.addEventListener('mouseenter', () => controller.onMouseEnter());

// ---------- Tauri window focus/blur + drag-drop ----------
async function wireTauri() {
  if (!inTauri()) {
    appEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      appEl.classList.add('dragging');
    });
    appEl.addEventListener('dragleave', () => appEl.classList.remove('dragging'));
    appEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      appEl.classList.remove('dragging');
      const file = e.dataTransfer?.files?.[0];
      if (file) {
        inputEl.value = `/init ${file.name}`;
        autoSize();
      }
    });
    return;
  }

  // OS-level boss hotkey — works even when the webview would eat ⌘⇧B.
  try {
    const gs = await import('@tauri-apps/plugin-global-shortcut');
    await gs.register('CommandOrControl+Shift+B', (e: any) => {
      if (e && e.state === 'Released') return; // fire once, on key-down
      controller.toggleBoss('hotkey');
    });
    bossHotkeyViaGlobal = true;
  } catch {
    // registration failed (e.g. taken by another app) — keep the in-page fallback
  }

  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const { getCurrentWebview } = await import('@tauri-apps/api/webview');
  const win = getCurrentWindow();

  let blurTimer: ReturnType<typeof setTimeout> | undefined;
  await win.onFocusChanged(({ payload: focused }) => {
    if (!focused) {
      const delay = cfg.bossBlurDelay;
      if (delay > 0 && cfg.bossTriggers.includes('blur')) {
        if (blurTimer) clearTimeout(blurTimer);
        blurTimer = setTimeout(() => controller.onWindowBlur(), delay);
      }
    } else {
      if (blurTimer) {
        clearTimeout(blurTimer);
        blurTimer = undefined;
      }
      controller.onWindowFocus();
    }
  });

  const webview = getCurrentWebview();
  await webview.onDragDropEvent((event) => {
    const t = event.payload.type;
    if (t === 'over') {
      appEl.classList.add('dragging');
    } else if (t === 'leave') {
      appEl.classList.remove('dragging');
    } else if (t === 'drop') {
      appEl.classList.remove('dragging');
      const paths = (event.payload as any).paths as string[] | undefined;
      const path = paths?.[0];
      if (path) {
        hardReset();
        void controller.handleInput(`/init ${path}`);
      }
    }
  });
}

// ---------- auto-update ----------
// Two flows (desktop only; no-op in browser dev):
//  • cold start  → an update found here is forced (mandatory modal, no skip).
//  • while open  → poll every 30 min; a new version shows a red header badge
//                  the user can open and update at their leisure.
const updatePrompt = new UpdatePrompt();
const UPDATE_POLL_MS = 30 * 60 * 1000;

async function checkUpdatesOnStart() {
  const info = await checkForUpdate();
  if (info) updatePrompt.forced(info);
}

function startUpdatePolling() {
  setInterval(async () => {
    const info = await checkForUpdate();
    if (info) updatePrompt.badgePrompt(info);
  }, UPDATE_POLL_MS);
}

// ---------- boot ----------
async function boot() {
  applyIdentity();
  await state.init();
  sidebar.reorder(); // sort once on app open
  sidebar.refresh();
  await wireTauri();
  await controller.start();
  inputEl.focus();
  // Defer the first update check a few seconds so it never competes with boot.
  setTimeout(() => {
    void checkUpdatesOnStart();
    startUpdatePolling();
  }, 4000);
}
void boot();
