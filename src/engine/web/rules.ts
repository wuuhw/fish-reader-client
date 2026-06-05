// Per-host extraction rules. A rule is learned (auto-detected or 手动录制) the
// first time a site is read, saved locally, then reused so the same site is
// recognized instantly next time. Keyed by hostname.

import { SiteRule } from './extract';

const KEY = 'fishReader.webRules';

type RuleMap = Record<string, SiteRule>;

function load(): RuleMap {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as RuleMap;
  } catch {
    /* ignore */
  }
  return {};
}

function persist(map: RuleMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** The saved rule for a URL's host, if any. */
export function getRuleForUrl(url: string): SiteRule | undefined {
  const host = hostOf(url);
  return host ? load()[host] : undefined;
}

/** Save / overwrite the rule for a host. */
export function saveRule(rule: SiteRule): void {
  if (!rule.host) return;
  const map = load();
  map[rule.host] = rule;
  persist(map);
}

export function removeRule(host: string): void {
  const map = load();
  delete map[host];
  persist(map);
}

export function allRules(): SiteRule[] {
  return Object.values(load());
}
