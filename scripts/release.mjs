#!/usr/bin/env node
// Interactive release helper.
//
//   pnpm release
//
// Flow:
//   1. shows the current version (read from package.json)
//   2. prompts for the new version (validated semver, must be > current)
//   3. bumps version in package.json / tauri.conf.json / src-tauri/Cargo.toml
//   4. shows a summary + git status, asks to confirm
//   5. commits all changes, creates tag v<version>, pushes branch + tag
//
// Pushing the tag triggers .github/workflows/release.yml → build → sign →
// upload to Aliyun OSS. Old clients then see the update.

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = join(root, 'package.json');
const CONF = join(root, 'src-tauri', 'tauri.conf.json');
const CARGO = join(root, 'src-tauri', 'Cargo.toml');

const C = { dim: (s) => `\x1b[2m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m`, g: (s) => `\x1b[32m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m` };

function die(msg) {
  console.error(C.r(`\n✖ ${msg}\n`));
  process.exit(1);
}

function sh(cmd, opts = {}) {
  return execSync(cmd, { cwd: root, stdio: 'pipe', encoding: 'utf8', ...opts }).trim();
}

// Compare two "a.b.c" versions → 1 / 0 / -1.
function cmpSemver(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

const rl = createInterface({ input, output });

try {
  // --- preflight: git repo + clean enough to know what we're committing ---
  let branch;
  try {
    branch = sh('git rev-parse --abbrev-ref HEAD');
  } catch {
    die('当前目录不是 git 仓库。');
  }

  const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
  const current = pkg.version;
  console.log(`\n  当前版本:  ${C.b(C.y('v' + current))}`);
  console.log(C.dim(`  当前分支:  ${branch}`));

  const status = sh('git status --porcelain');
  if (status) {
    console.log(C.dim('\n  检测到未提交的改动(将一并提交):'));
    console.log(
      status
        .split('\n')
        .map((l) => '    ' + l)
        .join('\n')
    );
  }

  // --- prompt for the new version ---
  const answer = (await rl.question(`\n  ${C.b('要发布的新版本')} (例如 ${suggestNext(current)}): `)).trim().replace(/^v/, '');
  if (!answer) die('未输入版本号,已取消。');
  if (!/^\d+\.\d+\.\d+$/.test(answer)) die(`版本号格式不对: "${answer}"(应为 x.y.z)。`);
  if (cmpSemver(answer, current) <= 0) die(`新版本 v${answer} 必须大于当前 v${current}。`);

  const tag = `v${answer}`;
  // tag must not already exist
  const tags = sh('git tag --list').split('\n');
  if (tags.includes(tag)) die(`tag ${tag} 已存在。`);

  // --- bump the three version sources ---
  bumpJsonVersion(PKG, answer);
  bumpJsonVersion(CONF, answer);
  bumpCargoVersion(CARGO, answer);
  console.log(C.g(`\n  ✓ 已更新 package.json / tauri.conf.json / Cargo.toml → v${answer}`));

  // --- confirm before the irreversible bits (commit + push + CI release) ---
  console.log(C.dim('\n  接下来将执行:'));
  console.log(C.dim(`    • git add -A`));
  console.log(C.dim(`    • git commit -m "release: ${tag}"`));
  console.log(C.dim(`    • git tag -a ${tag}`));
  console.log(C.dim(`    • git push origin ${branch} --follow-tags`));
  console.log(C.dim(`    → 触发 GitHub Actions 构建并发布到 OSS`));

  const ok = (await rl.question(`\n  确认提交并推送? 这会触发线上发布 (${C.b('y')}/N): `)).trim().toLowerCase();
  if (ok !== 'y' && ok !== 'yes') {
    console.log(C.y('\n  已取消。版本号改动保留在工作区(未提交),可手动还原或重跑。\n'));
    process.exit(0);
  }

  // --- commit, tag, push ---
  rl.close();
  console.log('');
  run(`git add -A`);
  run(`git commit -m "release: ${tag}"`);
  // annotated tag so `git push --follow-tags` actually pushes it (lightweight tags aren't)
  run(`git tag -a ${tag} -m "release ${tag}"`);
  run(`git push origin ${branch} --follow-tags`);

  console.log(C.g(`\n  ✓ 已推送 ${tag}。前往 GitHub Actions 查看构建进度。`));
  console.log(C.dim(`    构建完成后,安装包与 latest.json 会自动上传到 OSS。\n`));
} finally {
  rl.close();
}

// ---------------------------------------------------------------------------

function run(cmd) {
  console.log(C.dim(`  $ ${cmd}`));
  execSync(cmd, { cwd: root, stdio: 'inherit' });
}

function suggestNext(v) {
  const p = v.split('.').map(Number);
  return `${p[0]}.${p[1]}.${(p[2] || 0) + 1}`;
}

// Replace only the top-level "version": "..." (works for package.json & tauri.conf.json).
function bumpJsonVersion(file, version) {
  const raw = readFileSync(file, 'utf8');
  const next = raw.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`);
  if (next === raw) die(`未能在 ${file} 找到 version 字段。`);
  writeFileSync(file, next);
}

// Replace the [package] version line in Cargo.toml (anchored, so deps' version = "..." are untouched).
function bumpCargoVersion(file, version) {
  const raw = readFileSync(file, 'utf8');
  const next = raw.replace(/^version = "[^"]*"$/m, `version = "${version}"`);
  if (next === raw) die(`未能在 ${file} 找到 [package] 的 version。`);
  writeFileSync(file, next);
}
