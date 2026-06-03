// Brand identity + outbound links, used by the 关于 section, the first-run
// onboarding, and the discreet header entry. Single source of truth so the
// 官网 / GitHub / 抖音 URLs only need editing here.

export const BRAND = {
  /** Real product name (app/brand) — distinct from the in-app disguise name. */
  name: 'FishReader',
  /** Official site. */
  site: 'https://moyulao.cn',
  /** Source repo (releases live here). */
  github: 'https://github.com/wuuhw/fish-reader-client',
  /** Douyin number — clicking 抖音 copies this (抖音 is mobile-only, no web profile). */
  douyinId: '1642834098',
} as const;

/** Marketing pitch shown in the 关于 block + first-run onboarding follow card. */
export const FOLLOW_PITCH =
  '专注摸鱼干货 🐟 不定期更新摸鱼技巧、摸鱼神器软件。想上班轻松摸鱼、有摸鱼刚需,直接关注我!想定制摸鱼软件,或希望 FishReader 新增功能 —— 评论留言 / 私信即可。';

/** App version, injected by Vite at build time from package.json. */
export const APP_VERSION: string =
  (import.meta as any).env?.VITE_APP_VERSION ?? '0.1.1';
