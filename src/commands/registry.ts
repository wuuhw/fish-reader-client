import { CommandSpec } from '../types';

export const COMMANDS: CommandSpec[] = [
  { name: '/init', display: '/init', aliases: ['/open', '/load', '/打开'], description: '关联本地 txt 文件 或 小说网址', paramHint: '<path|url>' },
  { name: '/目录', display: '/toc', aliases: ['/toc', '/contents'], description: '查看章节列表' },
  { name: '/下一页', display: '/next', aliases: ['/n', '/next', '/下一章', '/下一段'], description: '下一章(整章输出)' },
  { name: '/上一页', display: '/prev', aliases: ['/p', '/prev', '/上一章', '/上一段'], description: '上一章' },
  { name: '/跳转', display: '/jump', aliases: ['/jump', '/goto'], description: '跳到第 N 章', paramHint: '<章节号>' },
  { name: '/搜索', display: '/search', aliases: ['/search', '/find'], description: '全文搜索', paramHint: '<关键词>' },
  { name: '/书签', display: '/bookmark', aliases: ['/bookmark', '/bm'], description: '书签:add 名称 / list / jump 序号', paramHint: '[add 名称|list|jump 序号]' },
  { name: '/历史', display: '/history', aliases: ['/switch', '/history'], description: '切换最近读过的书', paramHint: '[N]' },
  { name: '/设置', display: '/settings', aliases: ['/settings', '/config'], description: '打开配置面板' },
  { name: '/boss', display: '/boss', aliases: ['/老板'], description: '手动触发老板键' },
  { name: '/恢复', display: '/resume', aliases: ['/resume'], description: '退出老板键(摸鱼态)' },
  { name: '/help', display: '/help', aliases: ['/帮助', '/?'], description: '查看帮助' },
];

export interface ParsedCommand {
  spec?: CommandSpec;
  /** canonical command name (the spec.name) or the raw token if unknown */
  cmd: string;
  args: string;
  raw: string;
}

/** Resolve any alias/name token to a canonical CommandSpec. */
export function resolveCommand(token: string): CommandSpec | undefined {
  const t = token.toLowerCase();
  return COMMANDS.find(
    (c) => c.name.toLowerCase() === t || c.aliases.some((a) => a.toLowerCase() === t)
  );
}

export function parseInput(raw: string): ParsedCommand {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/')) {
    return { cmd: '', args: trimmed, raw };
  }
  const spaceIdx = trimmed.indexOf(' ');
  const token = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();
  const spec = resolveCommand(token);
  return { spec, cmd: spec ? spec.name : token, args, raw };
}

/** Fuzzy match for the slash menu. Returns specs whose name/alias contains the query subsequence. */
export function matchCommands(query: string): CommandSpec[] {
  const q = query.replace(/^\//, '').toLowerCase();
  if (!q) return COMMANDS;
  const sub = (hay: string) => {
    let i = 0;
    for (const ch of hay.toLowerCase()) if (ch === q[i]) i++;
    return i === q.length;
  };
  return COMMANDS.filter(
    (c) =>
      sub((c.display ?? c.name).replace(/^\//, '')) ||
      sub(c.name.replace(/^\//, '')) ||
      c.aliases.some((a) => sub(a.replace(/^\//, ''))) ||
      c.description.toLowerCase().includes(q)
  );
}
