// Thin wrappers around the Tauri Rust commands. When running outside Tauri
// (e.g. a plain `vite` dev server in a browser), these degrade gracefully so the
// UI still loads — file reading uses the File API and state uses localStorage.

import { invoke } from '@tauri-apps/api/core';

export interface BookFile {
  text: string;
  encoding: string;
  byteSize: number;
  baseName: string;
}

/** Are we running inside the Tauri webview (vs. a plain browser)? */
export function inTauri(): boolean {
  return typeof (window as any).__TAURI_INTERNALS__ !== 'undefined';
}

export async function readBook(path: string, forced = 'auto'): Promise<BookFile> {
  const r = await invoke<{ text: string; encoding: string; byte_size: number; base_name: string }>(
    'read_book',
    { path, forced }
  );
  return { text: r.text, encoding: r.encoding, byteSize: r.byte_size, baseName: r.base_name };
}

export interface FileBytes {
  bytes: Uint8Array;
  byteSize: number;
  baseName: string;
}

/** Read a file's raw bytes (for EPUB/FB2). Tauri only. */
export async function readBytes(path: string): Promise<FileBytes> {
  const r = await invoke<{ base64: string; byte_size: number; base_name: string }>('read_bytes', {
    path,
  });
  const bin = atob(r.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, byteSize: r.byte_size, baseName: r.base_name };
}

export async function loadStateRaw(): Promise<string> {
  if (!inTauri()) return localStorage.getItem('fishReader.state') ?? '{}';
  try {
    return await invoke<string>('load_state');
  } catch {
    return '{}';
  }
}

export async function saveStateRaw(json: string): Promise<void> {
  if (!inTauri()) {
    localStorage.setItem('fishReader.state', json);
    return;
  }
  try {
    await invoke('save_state', { json });
  } catch {
    /* ignore */
  }
}

export type BossAction = 'minimize' | 'hide' | 'show' | 'pin' | 'unpin';

export async function bossWindow(action: BossAction): Promise<void> {
  if (!inTauri()) return;
  try {
    await invoke('boss_window', { action });
  } catch {
    /* ignore */
  }
}

export interface WebPage {
  html: string;
  finalUrl: string;
  encoding: string;
  status: number;
}

/**
 * Fetch a web page's HTML (Rust-side request → no browser CORS; GB2312/GBK
 * decoded like local files). Throws "challenge:cloudflare" when blocked by a
 * Cloudflare bot challenge (frontend escalates to a webview in a later phase).
 */
export async function fetchUrl(url: string): Promise<WebPage> {
  if (!inTauri()) {
    // Browser dev can't bypass CORS; the web-reader is a Tauri-only feature.
    throw new Error('网页抓取仅在桌面客户端可用');
  }
  const r = await invoke<{ html: string; final_url: string; encoding: string; status: number }>(
    'fetch_url',
    { url }
  );
  return { html: r.html, finalUrl: r.final_url, encoding: r.encoding, status: r.status };
}

/** Open an external URL in the system browser (官网 / GitHub / 抖音). */
export async function openExternal(url: string): Promise<void> {
  if (!inTauri()) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}
