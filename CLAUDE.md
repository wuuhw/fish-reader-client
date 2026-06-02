# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

FishReader desktop client (PRD 形态 C) — a TXT/EPUB/FB2 novel reader disguised as the 豆包 (Doubao) AI assistant. Tauri 2 shell, vanilla TS + native CSS frontend, Rust backend. It is a 1:1 functional replica of the sibling VSCode extension at `/Users/hongweiwu/fishReader/fish-reader-vscode` (an additional working directory) — feature parity with that extension is the design contract.

## Commands

```bash
# Install — the machine's default npm mirror (rongdasoft) is missing packages, MUST override registry
pnpm install --registry=https://registry.npmjs.org/

pnpm tauri:dev      # Tauri window + Vite (full app)
pnpm tauri:build    # Production installer (.dmg/.exe/.AppImage)
pnpm dev            # Vite-only at http://localhost:5183 (browser fallback, file IO degrades to File API + localStorage)
pnpm build          # tsc --noEmit + vite build (typecheck + frontend bundle)

# Rust side
cargo check --manifest-path src-tauri/Cargo.toml
```

No test runner is configured. Verification = `tsc --noEmit`, `vite build`, `cargo check`, `pnpm tauri:dev` launches.

## Architecture

**Split of responsibilities — keep this boundary intact:**

- **Rust (`src-tauri/src/lib.rs`)** does only: file IO + encoding detection (BOM → UTF-8 validate → GB18030 via `encoding_rs`), raw-bytes read for EPUB/FB2, JSON state persistence in app config dir (equivalent to VSCode's `globalState`), and window-level boss actions (`minimize`/`hide`/`show`/`pin`).
- **Frontend TS (`src/`)** owns everything else: the reading engine, chapter parsing, pagination, search, slash-command parser, disguise generators, UI rendering. The engine was ported from the VSCode extension's `src/engine` largely verbatim — preserve that symmetry.

**Tauri bridge (`src/tauri.ts`)** gracefully degrades when `inTauri()` is false (browser dev mode uses File API + localStorage). Any new Rust command needs a matching wrapper here with a browser fallback.

**Controller (`src/controller.ts`)** orchestrates everything via a `ControllerHooks` contract: `enqueue` (sequential animation queue), `hardReset` (drop pending tasks / abort streams), `onBooksChanged`, `onBossChange`, `onToc`. `main.ts` wires these to the DOM. UI rendering is sequential by design — chat output goes through the enqueue → stream pipeline.

### Shared format parsers (cross-repo!)

`src/engine/formats/` (`html-text.ts`, `epub.ts`, `fb2.ts`, `structured.ts`) is a **pure-TS, regex-based** parser set using `fflate` for unzip. No DOMParser — so the same code runs in both the Tauri webview AND the VSCode Node host. **These files are duplicated verbatim into `fish-reader-vscode/src/engine/formats/`.** When you change anything in `formats/`, update both repos to keep parsing aligned.

Parsers return `ParsedBook { title, chapters: {title,text}[] }`; `chaptersToText` flattens to a text blob + Chapter offsets, fed into `ReaderEngine` via its `prebuiltChapters`/`bookTitle` opts (bypasses the txt chapter-regex). `controller.loadBook` routes by extension: epub/fb2 use `readBytes` (base64 → Uint8Array), txt uses `read_book` (Rust-decoded string).

### Disguise (boss mode) — profession-typed

`src/disguise/professions.ts` (replaced an older `boss-mode.ts`) holds 8 built-in professions (程序员/产品/运营/设计/财务/文案/教师/数据分析). Each profession defines:
- `readingInserts` — woven between novel paragraphs during normal reading
- `bossTurns` — full work-style Q&A rendered when boss mode is on
- `historyNames` — 5-6 fake 历史对话 titles that replace real book titles in the sidebar while disguising

The legacy "code diff" mechanic is generalized to an `InsertBlock` union (diff / table / list / doc / code), rendered by `UI.renderInsert`. Users can also paste a custom profession as JSON: settings has a 职业名称 input + "复制生成 Prompt" (`buildGeneratorPrompt(name)`) → paste into any external AI → JSON back → `parseProfession` imports it (must include `historyNames`).

`config.bossAction` switches the boss behavior to `minimize` / `hide` (window-level) instead of the fake-conversation overlay.

### Sidebar / history-as-library

`src/ui/sidebar.ts` renders the 历史对话 list = real novel library. Hover ⋯ → 隐藏/删除 (`state.setHidden` / `state.removeBook`). When boss mode toggles on, `src/ui/fake-names.ts` swaps the entire visible list to fake work-conversation titles and the ⋯ menu is hidden; clicking a row only emits one more fake bossTurn, never leaks a novel. Toggling off restores real titles.

### Visual style — locked

Two-pane Doubao desktop layout: left sidebar (avatar + decorative fake skills: AI 搜索 / 帮我写作 / 图像生成 / AI 编程 + AI 云盘 + 历史对话) + right chat area, light theme. Assistant messages = full-width plain text; user messages = right-aligned gray bubble. **Do not** revert to the older Claude-Code dark disguise or single-column mobile look — those were explicitly rejected.

## Config

`src/config.ts` (persisted in localStorage): `charsPerPage`, `encoding`, `chapterRegex`, `maxChapterChars`, `fakeThinkingSpeed`, `fakeDiff*`, `boss*` (trigger mode, delay, action, fake-turn count), `avatarName`.

## Differences from the VSCode extension

- Encoding: `encoding_rs` (Rust) instead of `iconv-lite` (Node) — logic equivalent.
- Boss content: pre-built profession Q&A pool (desktop has no active editor tab to scrape).
- Visual: Doubao light theme, not Claude-Code dark.
- No fake-token status bar (Doubao has none).
