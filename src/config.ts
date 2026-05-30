// App configuration with sensible defaults (mirrors the VSCode extension's
// fishReader.* settings). Persisted in localStorage so /设置 changes survive.

import type { Profession } from './disguise/professions';

export interface AppConfig {
  charsPerPage: number;
  encoding: 'auto' | 'utf-8' | 'gbk' | 'gb18030';
  chapterRegex: string;
  maxChapterChars: number;
  mergeParagraphs: boolean;
  paragraphTargetChars: number;

  fakeThinkingSpeed: 'slow' | 'normal' | 'fast' | 'off';
  fakeDiffEnabled: boolean;
  fakeDiffFrequency: number;
  fakeDiffLanguage: string; // 'auto' or a specific language

  bossFakeConversationCount: number;
  bossTriggers: Array<'blur' | 'mouseLeave'>;
  bossMouseLeaveDelay: number;
  bossBlurDelay: number;
  bossAutoExit: boolean;
  bossAction: 'disguise' | 'minimize' | 'hide';

  avatarName: string;
  avatarDataUrl?: string; // custom avatar image (data: URL)

  professionId: string; // which disguise profession drives fake work content
  customProfessions: Profession[]; // user-imported professions (via JSON)
}

export const DEFAULTS: AppConfig = {
  charsPerPage: 300,
  encoding: 'auto',
  chapterRegex: '^\\s*(第[\\d一二三四五六七八九十百千零两]+[章节卷回篇]|[Cc]hapter\\s+\\d+|楔子|序章|番外).*$',
  maxChapterChars: 3000,
  mergeParagraphs: true,
  paragraphTargetChars: 120,

  fakeThinkingSpeed: 'normal',
  fakeDiffEnabled: true,
  fakeDiffFrequency: 0.7,
  fakeDiffLanguage: 'auto',

  bossFakeConversationCount: 3,
  bossTriggers: ['blur', 'mouseLeave'],
  bossMouseLeaveDelay: 1000,
  bossBlurDelay: 5000,
  bossAutoExit: false,
  bossAction: 'disguise',

  avatarName: '豆包',

  professionId: 'programmer',
  customProfessions: [],
};

const KEY = 'fishReader.config';

export function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS };
}

export function saveConfig(cfg: AppConfig): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}

export function mergeTarget(cfg: AppConfig): number {
  return cfg.mergeParagraphs ? cfg.paragraphTargetChars : 50;
}
