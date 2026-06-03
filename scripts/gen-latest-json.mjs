#!/usr/bin/env node
// Generate the Tauri updater manifest (latest.json) from built bundles.
//
// Scans a directory tree (the collected CI artifacts) for the updater bundles
// and their `.sig` signatures, then emits a latest.json whose download URLs
// point at Aliyun OSS:  <OSS_BASE>/v<version>/<filename>
//
// Usage:
//   node scripts/gen-latest-json.mjs \
//     --dir ./artifacts \
//     --version 0.1.1 \
//     --base https://moyulao.oss-cn-beijing.aliyuncs.com/updates \
//     --out ./latest.json \
//     --notes "本次更新内容…"
//
// Per-platform mapping (matches `createUpdaterArtifacts: true`):
//   *.app.tar.gz   -> darwin-x86_64 + darwin-aarch64  (universal build)
//   *-setup.exe    -> windows-x86_64                  (NSIS installer)
//   *.AppImage     -> linux-x86_64

import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const dir = arg('dir', './artifacts');
const version = (arg('version', '') || '').replace(/^v/, '');
const base = (arg('base', '')).replace(/\/$/, '');
const out = arg('out', './latest.json');
const downloadsOut = arg('downloads-out', '');
const notes = arg('notes', '本次更新包含若干改进与修复。');

if (!version) throw new Error('missing --version');
if (!base) throw new Error('missing --base (OSS public URL)');

// Recursively collect every file path under `dir`.
function walk(d) {
  const out = [];
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const files = walk(dir);
const basename = (p) => p.split('/').pop();
const sigOf = (bundlePath) => {
  const sig = files.find((f) => f === `${bundlePath}.sig`);
  if (!sig) throw new Error(`missing signature for ${basename(bundlePath)} (.sig not found)`);
  return readFileSync(sig, 'utf8').trim();
};
const urlOf = (p) => `${base}/v${version}/${encodeURIComponent(basename(p))}`;

const platforms = {};

const mac = files.find((f) => f.endsWith('.app.tar.gz'));
if (mac) {
  const entry = { signature: sigOf(mac), url: urlOf(mac) };
  platforms['darwin-x86_64'] = entry;
  platforms['darwin-aarch64'] = entry;
}

const win = files.find((f) => /-setup\.exe$/i.test(f));
if (win) platforms['windows-x86_64'] = { signature: sigOf(win), url: urlOf(win) };

const linux = files.find((f) => f.endsWith('.AppImage'));
if (linux) platforms['linux-x86_64'] = { signature: sigOf(linux), url: urlOf(linux) };

if (!Object.keys(platforms).length) {
  throw new Error('no updater bundles found — did createUpdaterArtifacts run with signing keys?');
}

const manifest = {
  version: `v${version}`,
  notes,
  pub_date: new Date().toISOString(),
  platforms,
};

writeFileSync(out, JSON.stringify(manifest, null, 2));
console.log(`wrote ${out}:`);
console.log(JSON.stringify(manifest, null, 2));

// ---------------------------------------------------------------------------
// downloads.json — user-facing installers for the official website.
// Note: macOS points at the .dmg (a first-time install), NOT the .app.tar.gz
// (that one is only for the in-app updater).
// ---------------------------------------------------------------------------
if (downloadsOut) {
  const dmg = files.find((f) => f.endsWith('.dmg'));
  const exe = files.find((f) => /-setup\.exe$/i.test(f));
  const appimage = files.find((f) => f.endsWith('.AppImage'));
  const deb = files.find((f) => f.endsWith('.deb'));

  const downloads = {
    version: `v${version}`,
    pub_date: manifest.pub_date,
    mac: dmg ? urlOf(dmg) : null,
    win: exe ? urlOf(exe) : null,
    linux: appimage ? urlOf(appimage) : null,
    linuxDeb: deb ? urlOf(deb) : null,
  };
  writeFileSync(downloadsOut, JSON.stringify(downloads, null, 2));
  console.log(`\nwrote ${downloadsOut}:`);
  console.log(JSON.stringify(downloads, null, 2));
}
