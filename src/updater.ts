// Auto-update bridge around the Tauri updater plugin.
//
// The updater checks a static `latest.json` published on Aliyun OSS, verifies
// the package signature (minisign, independent of macOS code-signing), then
// downloads + installs the new bundle and relaunches the app.
//
// In plain-browser dev mode (`inTauri()` === false) every entry point is a
// no-op so `pnpm dev` keeps working without a Tauri backend.

import { inTauri } from './tauri';

export interface UpdateInfo {
  version: string; // the new version, e.g. "0.1.1"
  currentVersion: string; // the running version
  notes: string; // release notes (latest.json -> "notes")
  date?: string; // pub_date, if present
}

/** Progress of an in-flight download, 0..1 (or -1 when total size unknown). */
export type ProgressFn = (fraction: number, downloaded: number, total: number) => void;

// The resolved `Update` handle from the most recent check(), kept so that the
// UI can trigger downloadAndInstall() on the very object check() returned.
let pendingUpdate: any | null = null;

/**
 * Ask the OSS endpoint whether a newer version exists.
 * Returns the update info (and stashes the handle for runUpdate) or null.
 * Never throws — network/parse errors resolve to null so callers stay simple.
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!inTauri()) return null;
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (!update) {
      pendingUpdate = null;
      return null;
    }
    pendingUpdate = update;
    return {
      version: update.version,
      currentVersion: update.currentVersion,
      notes: update.body ?? '',
      date: update.date ?? undefined,
    };
  } catch (e) {
    console.error('[updater] check failed', e);
    pendingUpdate = null;
    return null;
  }
}

/**
 * Download + install the update found by the last checkForUpdate(), reporting
 * progress, then relaunch into the new version. Throws on failure so the UI
 * can surface a retry.
 */
export async function runUpdate(onProgress?: ProgressFn): Promise<void> {
  if (!inTauri() || !pendingUpdate) return;
  let total = 0;
  let downloaded = 0;
  await pendingUpdate.downloadAndInstall((event: any) => {
    switch (event.event) {
      case 'Started':
        total = event.data?.contentLength ?? 0;
        downloaded = 0;
        onProgress?.(total > 0 ? 0 : -1, 0, total);
        break;
      case 'Progress':
        downloaded += event.data?.chunkLength ?? 0;
        onProgress?.(total > 0 ? downloaded / total : -1, downloaded, total);
        break;
      case 'Finished':
        onProgress?.(1, total || downloaded, total || downloaded);
        break;
    }
  });

  // Installed — relaunch so the user lands in the new build immediately.
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}
