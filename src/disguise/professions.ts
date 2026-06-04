// Profession-typed disguise content. The app isn't only for programmers, so the
// fake "work" shown while reading (insert stream) and in boss mode (Q&A) comes in
// several professional flavors — and users can import their own via JSON.

import type { AppConfig } from '../config';

// ---- the generalized "work artifact" block (was: a code diff) ----
export type InsertBlock =
  | { kind: 'diff'; fileName: string; lines: { type: 'add' | 'del' | 'ctx'; text: string }[] }
  | { kind: 'table'; title: string; headers: string[]; rows: string[][] }
  | { kind: 'list'; title: string; ordered?: boolean; items: string[] }
  | { kind: 'doc'; title: string; paragraphs: string[] }
  | { kind: 'code'; title: string; lang?: string; lines: string[] };

export interface InsertRef {
  label: string; // small gray header, e.g. "更新 竞品分析.xlsx"
  block: InsertBlock;
}

/** A short artifact woven between novel paragraphs while reading. */
export interface ReadingInsert {
  label: string;
  note: string; // one-line "what I just did"
  block: InsertBlock;
}

/** A full fake "working" Q&A turn for boss mode. */
export interface BossTurn {
  prompt: string;
  thinking: string[];
  answer: string;
  insert?: InsertRef;
}

export interface Profession {
  id: string;
  name: string;
  readingInserts: ReadingInsert[];
  bossTurns: BossTurn[];
  /** Fake 历史对话 titles shown in the sidebar while disguising (5-6 entries). */
  historyNames: string[];
}

// ---- compact builders ----
const T = (title: string, headers: string[], rows: string[][]): InsertBlock => ({ kind: 'table', title, headers, rows });
const L = (title: string, items: string[], ordered = false): InsertBlock => ({ kind: 'list', title, items, ordered });
const DOC = (title: string, paragraphs: string[]): InsertBlock => ({ kind: 'doc', title, paragraphs });
const CODE = (title: string, lang: string, lines: string[]): InsertBlock => ({ kind: 'code', title, lang, lines });
const DIFF = (fileName: string, lines: { type: 'add' | 'del' | 'ctx'; text: string }[]): InsertBlock => ({ kind: 'diff', fileName, lines });
const a = (text: string) => ({ type: 'add' as const, text });
const d = (text: string) => ({ type: 'del' as const, text });
const c = (text: string) => ({ type: 'ctx' as const, text });

// =========================================================================
// Built-in professions
// =========================================================================

const programmer: Profession = {
  id: 'programmer',
  name: '程序员',
  readingInserts: [
    { label: 'edited utils.ts', note: '把重复的字面量抽成了常量', block: DIFF('utils.ts', [d('const timeout = 5000;'), a('const DEFAULT_TIMEOUT_MS = 5000;'), d('setTimeout(fn, 5000);'), a('setTimeout(fn, DEFAULT_TIMEOUT_MS);')]) },
    { label: 'edited api.ts', note: '补了空值兜底,空输入不再抛错', block: DIFF('api.ts', [d('return user.profile.name;'), a("return user?.profile?.name ?? 'Anonymous';")]) },
    { label: 'edited parser.ts', note: '加了一层缓存,热路径少跑一次', block: DIFF('parser.ts', [a('const cache = new Map<string, number>();'), c('function compute(x: string) {'), a('  if (cache.has(x)) return cache.get(x)!;'), c('  return expensive(x);'), c('}')]) },
  ],
  bossTurns: [
    { prompt: '这段 SQL 太慢了,帮我看看怎么优化', thinking: ['检查执行计划…', '定位全表扫描…'], answer: '主要问题是 WHERE 里的 created_at 没走索引,导致全表扫描。建议:\n\n1. 在 (status, created_at) 上建联合索引;\n2. SELECT * 改成只取需要的列;\n3. 大表分页用游标代替 OFFSET。', insert: { label: 'edited query.sql', block: CODE('query.sql', 'sql', ['CREATE INDEX idx_status_created', '  ON orders (status, created_at);', '', 'SELECT id, amount FROM orders', 'WHERE status = ? AND id > ?', 'ORDER BY id LIMIT 50;']) } },
    { prompt: 'review 一下这个函数,感觉有点问题', thinking: ['通读实现…', '检查边界条件…'], answer: '逻辑主体没问题,但两处可以加固:入参为空时直接返回更安全;重复查表可以提到循环外缓存一次。我改了一版:', insert: { label: 'edited service.ts', block: DIFF('service.ts', [c('function handle(items) {'), a('  if (!items?.length) return [];'), a('  const idx = buildIndex();'), c('  return items.map(...)'), c('}')]) } },
    { prompt: 'add error handling to fetchUser', thinking: ['analyzing call sites…', 'wrapping with try/catch…'], answer: '给 fetchUser 加了重试 + 超时,失败时回退到缓存数据,避免页面直接崩。', insert: { label: 'edited user.ts', block: CODE('user.ts', 'typescript', ['async function fetchUser(id: string) {', '  for (let i = 0; i < 3; i++) {', '    try { return await api.get(`/u/${id}`); }', '    catch (e) { if (i === 2) return cache.get(id); }', '  }', '}']) } },
  ],
  historyNames: ['线上 bug 排查', '接口联调记录', 'SQL 性能优化', '代码 review 笔记', '服务部署方案', '单元测试补充'],
};

const product: Profession = {
  id: 'product',
  name: '产品经理',
  readingInserts: [
    { label: '更新 需求池.xlsx', note: '把这条需求的优先级调成了 P0', block: T('需求优先级', ['需求', '优先级', '排期'], [['登录改版', 'P0', '本迭代'], ['消息中心', 'P1', '下迭代'], ['皮肤商城', 'P2', '待定']]) },
    { label: '更新 PRD-v2.docx', note: '补充了异常态的交互说明', block: L('待补充的边界场景', ['网络超时的重试与提示', '空数据的引导页', '权限不足时的降级展示']) },
    { label: '更新 竞品分析.xlsx', note: '对比了三家的核心功能差异', block: T('竞品对比', ['功能', 'A 产品', 'B 产品'], [['免费额度', '有', '无'], ['团队协作', '✓', '✓'], ['离线模式', '✗', '✓']]) },
  ],
  bossTurns: [
    { prompt: '帮我把这个需求拆成几个可执行的小任务', thinking: ['识别核心目标…', '按依赖关系拆分…'], answer: '可以拆成四步并行推进:\n\n1. 数据建模(0.5 天)\n2. 后端接口(1 天)\n3. 前端页面(1.5 天)\n4. 联调与测试(1 天)\n\n建议 1、2 先行,3 可与 2 并行。', insert: { label: '更新 排期表.xlsx', block: T('迭代排期', ['任务', '负责人', '工时'], [['数据建模', '后端', '0.5d'], ['接口开发', '后端', '1d'], ['页面开发', '前端', '1.5d']]) } },
    { prompt: '这个功能的核心指标应该怎么定?', thinking: ['梳理用户路径…', '匹配北极星指标…'], answer: '建议主指标看「7 日留存」,辅助看「核心功能渗透率」和「人均使用时长」。前期别堆太多指标,先盯住一条主线。', insert: { label: '更新 指标看板.md', block: L('指标体系', ['北极星:7 日留存率', '过程指标:功能渗透率 / 人均时长', '反向指标:崩溃率 / 客诉量'], true) } },
    { prompt: '帮我写一段这个版本的更新说明', thinking: ['提炼版本亮点…'], answer: '本次更新:全新登录体验,3 步完成注册;消息中心上线,重要通知不再错过;修复了若干已知问题,体验更顺滑。', insert: { label: '更新 发版说明.docx', block: DOC('v2.3 更新说明', ['全新登录体验,注册只需 3 步。', '消息中心上线,集中管理所有通知。', '优化多处交互细节,修复已知问题。']) } },
  ],
  historyNames: ['需求评审纪要', '竞品功能调研', '版本迭代规划', '用户反馈梳理', 'PRD 文档撰写', '数据指标定义'],
};

const operation: Profession = {
  id: 'operation',
  name: '运营',
  readingInserts: [
    { label: '更新 活动数据.xlsx', note: '核对了昨天的转化漏斗', block: T('转化漏斗', ['环节', '人数', '转化'], [['曝光', '12.4w', '—'], ['点击', '3.1w', '25%'], ['下单', '4200', '13.5%']]) },
    { label: '更新 活动方案.docx', note: '调整了优惠券的发放节奏', block: L('发券节奏', ['预热期:满 50 减 5,引流', '高峰期:满 100 减 20,促单', '返场期:无门槛 8 折,清尾']) },
    { label: '更新 选题排期.xlsx', note: '把这周的推文选题排上了', block: T('内容排期', ['日期', '选题', '形式'], [['周一', '新品种草', '图文'], ['周三', '用户故事', '短视频'], ['周五', '福利抽奖', '直播']]) },
  ],
  bossTurns: [
    { prompt: '这次活动的转化不太行,帮我分析下问题', thinking: ['拆解漏斗各环节…', '对比历史均值…'], answer: '问题主要卡在「点击→下单」这一环,只有 13.5%,低于均值 20%。大概率是落地页和优惠力度的问题。建议 A/B 测一版更直给的主图,优惠券前置到列表页。', insert: { label: '更新 复盘.xlsx', block: T('环节诊断', ['环节', '实际', '基准'], [['点击率', '25%', '22%'], ['下单率', '13.5%', '20%']]) } },
    { prompt: '帮我想几个这次大促的传播 slogan', thinking: ['围绕利益点发散…'], answer: '几个方向供选:\n\n• 「囤够一整年,就趁这三天」\n• 「别等了,全年最低就是现在」\n• 「省下的都是赚到的」\n\n建议主打第一条,稀缺感最强。', insert: { label: '更新 文案池.md', block: L('Slogan 候选', ['囤够一整年,就趁这三天', '全年最低就是现在', '省下的都是赚到的']) } },
    { prompt: '帮我写一条朋友圈推广文案', thinking: ['控制字数与节奏…'], answer: '🔥 年中大促开启!全场低至 5 折,前 100 名再送神秘好礼。点开链接,手慢无 👉', insert: { label: '更新 朋友圈.txt', block: DOC('推广文案', ['🔥 年中大促开启!', '全场低至 5 折,前 100 名再送神秘好礼。', '点开链接,手慢无 👉']) } },
  ],
  historyNames: ['活动方案策划', '转化数据复盘', '用户增长分析', '内容选题排期', '社群运营记录', '投放效果评估'],
};

const designer: Profession = {
  id: 'designer',
  name: '设计师',
  readingInserts: [
    { label: '标注 首页Banner.fig', note: '统一了主按钮的圆角与间距', block: L('设计规范', ['主按钮圆角 8px,高度 44px', '正文与图标间距 12px', '主色 #4D6BFE,文字对比度 ≥ 4.5']) },
    { label: '更新 配色.fig', note: '重新梳理了一套语义色板', block: T('色板', ['用途', '色值'], [['主色', '#4D6BFE'], ['成功', '#18A058'], ['警告', '#F0A020']]) },
    { label: '导出 切图.zip', note: '补齐了 @2x/@3x 切图', block: L('交付清单', ['图标 @2x / @3x', '空状态插画 1 套', '标注稿 PDF']) },
  ],
  bossTurns: [
    { prompt: '这个页面有点乱,帮我提几个优化建议', thinking: ['检查视觉层级…', '核对栅格对齐…'], answer: '三个问题:信息层级不清,标题和正文字号差太小;留白不均,卡片间距忽大忽小;主操作不突出。建议拉开字号梯度、统一 16px 栅格、把主按钮提到首屏。', insert: { label: '标注 优化点.fig', block: L('优化清单', ['标题字号提到 20,与正文拉开层级', '卡片间距统一 16px', '主按钮上移并加强对比'], true) } },
    { prompt: '帮我定一套这个品牌的字体规范', thinking: ['匹配品牌调性…'], answer: '建议中文用思源黑体,西文用 Inter。标题 Semibold,正文 Regular,行高 1.6。整体偏现代、克制。', insert: { label: '更新 字体规范.fig', block: T('字体', ['层级', '字号', '字重'], [['标题', '20', 'Semibold'], ['正文', '14', 'Regular'], ['辅助', '12', 'Regular']]) } },
  ],
  historyNames: ['首页改版评审', '设计规范梳理', '配色方案对比', '交互细节优化', '切图标注交付', '组件库整理'],
};

const finance: Profession = {
  id: 'finance',
  name: '财务',
  readingInserts: [
    { label: '更新 月度报表.xlsx', note: '核对了本月的收支明细', block: T('月度收支', ['项目', '金额', '环比'], [['收入', '128.4w', '+6%'], ['成本', '73.2w', '+2%'], ['利润', '55.2w', '+12%']]) },
    { label: '更新 预算表.xlsx', note: '调整了 Q3 的市场预算', block: T('Q3 预算', ['部门', '预算', '已用'], [['市场', '40w', '62%'], ['研发', '85w', '48%'], ['行政', '12w', '70%']]) },
    { label: '更新 报销台账.xlsx', note: '勾稽了这批差旅报销', block: L('待处理', ['差旅报销 8 笔,待审批', '发票验真 2 张异常', '月末计提待录入']) },
  ],
  bossTurns: [
    { prompt: '帮我分析下这个月利润为什么涨了', thinking: ['拆解收入结构…', '对比成本项…'], answer: '利润环比 +12%,主要来自两点:收入端新签了两个大客户,贡献 +6%;成本端去年同期的一次性投入今年没有了。可持续性看,建议关注新客户的回款周期。', insert: { label: '更新 利润分析.xlsx', block: T('利润归因', ['因素', '影响'], [['收入增长', '+6%'], ['成本下降', '+4%'], ['其他', '+2%']]) } },
    { prompt: '这笔大额支出要不要做专项审批?', thinking: ['核对审批权限表…'], answer: '该笔支出超过 50 万,超出部门负责人权限,需走专项审批:部门初审 → 财务复核 → 总经理终批,并附采购比价单。', insert: { label: '更新 审批流.md', block: L('审批链路', ['部门负责人初审', '财务复核(附比价)', '总经理终批'], true) } },
  ],
  historyNames: ['月度报表分析', '预算编制复核', '报销审批流程', '成本结构拆解', '税务筹划咨询', '现金流测算'],
};

const writer: Profession = {
  id: 'writer',
  name: '文案/新媒体',
  readingInserts: [
    { label: '更新 推文初稿.docx', note: '改了一版更抓人的开头', block: DOC('开头候选', ['你有没有过这种时刻——明明很累,却怎么也睡不着?', '今天想和你聊聊「精神内耗」这件小事。']) },
    { label: '更新 标题池.md', note: '攒了几个备选标题', block: L('标题候选', ['我把这件事坚持了 100 天,结果出乎意料', '别再这样做了,真的很伤身体', '这 3 个习惯,正在偷偷改变你']) },
    { label: '更新 选题表.xlsx', note: '排了下周的内容节奏', block: T('内容节奏', ['平台', '选题', '排期'], [['公众号', '深度长文', '周二'], ['小红书', '干货清单', '周四']]) },
  ],
  bossTurns: [
    { prompt: '帮我把这段话润色得更专业一点', thinking: ['分析语气与场景…', '调整为正式表达…'], answer: '可以改写为:\n\n「关于该事项,我整理了一个初步方案,具体思路如下。烦请评估其可行性,如需调整欢迎随时反馈。」\n\n更稳重,也保留了协商空间。', insert: { label: '更新 邮件.docx', block: DOC('改写后', ['关于该事项,我整理了一个初步方案。', '烦请评估可行性,如需调整欢迎随时反馈。']) } },
    { prompt: '帮我给这篇文章起几个标题', thinking: ['围绕痛点发散…'], answer: '几个方向:\n\n• 痛点式:「为什么你越努力,越焦虑?」\n• 干货式:「3 个方法,告别精神内耗」\n• 故事式:「她裸辞那天,我才看懂这件事」', insert: { label: '更新 标题.md', block: L('标题候选', ['为什么你越努力,越焦虑?', '3 个方法,告别精神内耗', '她裸辞那天,我才看懂这件事']) } },
  ],
  historyNames: ['推文标题打磨', '文章选题策划', '品牌 slogan 创作', '公众号排版', '短视频脚本', '朋友圈文案'],
};

const teacher: Profession = {
  id: 'teacher',
  name: '教师',
  readingInserts: [
    { label: '更新 教案.docx', note: '理了下这节课的环节', block: L('课堂环节', ['导入:情境提问 5 分钟', '新授:概念讲解 + 例题 20 分钟', '练习:分层作业 15 分钟', '小结:回顾 + 预告 5 分钟'], true) },
    { label: '更新 成绩册.xlsx', note: '录入了这次小测的分数', block: T('小测成绩', ['班级', '均分', '及格率'], [['1 班', '82.4', '94%'], ['2 班', '78.9', '88%']]) },
    { label: '更新 错题集.docx', note: '归类了这次的高频错题', block: L('高频错点', ['一元二次方程判别式符号', '应用题单位换算', '函数定义域遗漏']) },
  ],
  bossTurns: [
    { prompt: '帮我设计一个这节课的导入环节', thinking: ['贴合学情…', '设计悬念…'], answer: '可以用生活情境导入:先抛一个学生熟悉的问题(比如「怎么估算操场的面积」),引发认知冲突,再自然引出本节的测量方法,激发探究欲。', insert: { label: '更新 导入设计.docx', block: DOC('导入环节', ['情境:如何估算操场面积?', '冲突:目测误差大,需要更准的办法。', '引出:本节学习面积的测量与计算。']) } },
    { prompt: '帮我把这次考试做个简单的成绩分析', thinking: ['统计分布…', '定位薄弱点…'], answer: '整体均分 80.6,及格率 91%,属正常水平。两极分化在 2 班较明显,建议对后 20% 做针对性辅导,重点补函数与应用题。', insert: { label: '更新 成绩分析.xlsx', block: T('分数段分布', ['分数段', '人数'], [['90+', '12'], ['60-89', '38'], ['<60', '5']]) } },
  ],
  historyNames: ['课堂教案设计', '学生成绩分析', '错题归类整理', '教学反思记录', '家长沟通纪要', '试卷命题思路'],
};

const analyst: Profession = {
  id: 'analyst',
  name: '数据分析师',
  readingInserts: [
    { label: '更新 留存看板.xlsx', note: '拉了上周的留存曲线', block: T('留存', ['天数', '留存率'], [['次日', '42%'], ['7 日', '23%'], ['30 日', '11%']]) },
    { label: '运行 query.sql', note: '统计了各渠道的获客成本', block: CODE('query.sql', 'sql', ['SELECT channel,', '  SUM(cost)/COUNT(DISTINCT uid) AS cac', 'FROM acquisition', 'GROUP BY channel', 'ORDER BY cac;']) },
    { label: '更新 分析报告.md', note: '记了几个异常波动点', block: L('异动归因', ['周三 DAU 骤降:疑似推送故障', '渠道 B 转化翻倍:活动加持', '退款率上升:与新政策相关']) },
  ],
  bossTurns: [
    { prompt: '这周 DAU 跌了,帮我看下原因', thinking: ['对比分渠道数据…', '定位异常时点…'], answer: '跌幅集中在周三,且只在 Android 端。结合发版记录,大概率是当天的推送服务故障导致召回缺失。排除季节性因素后,核心指标无结构性问题。', insert: { label: '更新 归因.xlsx', block: T('DAU 拆解', ['维度', '变化'], [['iOS', '-2%'], ['Android', '-18%'], ['推送召回', '-60%']]) } },
    { prompt: '帮我设计一个 A/B 实验来验证这个改动', thinking: ['确定指标与样本量…'], answer: '主指标定「下单转化率」,最小可检测提升 3%,按当前流量需各组约 1.2w 样本、跑满 7 天。建议 50/50 分流,排除新用户干扰。', insert: { label: '更新 实验设计.md', block: L('实验配置', ['主指标:下单转化率', '分流:50/50', '样本量:各组 ~1.2w', '周期:7 天'], true) } },
  ],
  historyNames: ['留存数据分析', 'A/B 实验设计', '获客成本核算', '漏斗转化诊断', '指标异动归因', '看板搭建'],
};

export const BUILTIN_PROFESSIONS: Profession[] = [
  programmer,
  product,
  operation,
  designer,
  finance,
  writer,
  teacher,
  analyst,
];

// =========================================================================
// resolution + cycling
// =========================================================================

const bossCursor = new Map<string, number>();

/** All professions available to pick: built-ins + the user's imported ones. */
export function listProfessions(cfg: AppConfig): Profession[] {
  return [...BUILTIN_PROFESSIONS, ...(cfg.customProfessions ?? [])];
}

export function resolveProfession(cfg: AppConfig): Profession {
  const all = listProfessions(cfg);
  return all.find((p) => p.id === cfg.professionId) ?? all[0];
}

export function pickReadingInsert(prof: Profession): ReadingInsert | undefined {
  const pool = prof.readingInserts;
  if (!pool.length) return undefined;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Next N boss turns for a profession, cycling through its pool. */
export function nextBossTurns(prof: Profession, n: number): BossTurn[] {
  const pool = prof.bossTurns;
  if (!pool.length) return [];
  const out: BossTurn[] = [];
  let cur = bossCursor.get(prof.id) ?? 0;
  for (let i = 0; i < n; i++) {
    out.push(pool[cur % pool.length]);
    cur++;
  }
  bossCursor.set(prof.id, cur);
  return out;
}

/**
 * Deterministic N boss turns keyed by an arbitrary string — same key always
 * yields the same conversation. Used so each 历史对话 row in boss mode maps to a
 * stable, distinct fake conversation when switched to.
 */
export function bossTurnsForKey(prof: Profession, key: string, n: number): BossTurn[] {
  const pool = prof.bossTurns;
  if (!pool.length) return [];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const start = h % pool.length;
  const out: BossTurn[] = [];
  for (let i = 0; i < n; i++) out.push(pool[(start + i) % pool.length]);
  return out;
}

// =========================================================================
// JSON import + the prompt users paste into another AI
// =========================================================================

/** Validate + coerce arbitrary JSON into a Profession. Returns null if invalid. */
export function parseProfession(raw: string): Profession | null {
  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  if (typeof obj.name !== 'string' || !obj.name.trim()) return null;

  const id =
    typeof obj.id === 'string' && obj.id.trim()
      ? obj.id.trim()
      : 'custom-' + obj.name.trim().slice(0, 12);

  const blocks = (b: any): InsertBlock | undefined => {
    if (!b || typeof b !== 'object') return undefined;
    switch (b.kind) {
      case 'diff':
        if (!Array.isArray(b.lines)) return undefined;
        return { kind: 'diff', fileName: String(b.fileName ?? 'file'), lines: b.lines.map((l: any) => ({ type: l.type === 'add' || l.type === 'del' ? l.type : 'ctx', text: String(l.text ?? '') })) };
      case 'table':
        return { kind: 'table', title: String(b.title ?? ''), headers: (b.headers ?? []).map(String), rows: (b.rows ?? []).map((r: any[]) => (r ?? []).map(String)) };
      case 'list':
        return { kind: 'list', title: String(b.title ?? ''), ordered: !!b.ordered, items: (b.items ?? []).map(String) };
      case 'doc':
        return { kind: 'doc', title: String(b.title ?? ''), paragraphs: (b.paragraphs ?? []).map(String) };
      case 'code':
        return { kind: 'code', title: String(b.title ?? ''), lang: b.lang ? String(b.lang) : undefined, lines: (b.lines ?? []).map(String) };
      default:
        return undefined;
    }
  };

  const readingInserts: ReadingInsert[] = Array.isArray(obj.readingInserts)
    ? obj.readingInserts
        .map((r: any) => {
          const block = blocks(r?.block);
          if (!block) return null;
          return { label: String(r.label ?? ''), note: String(r.note ?? ''), block };
        })
        .filter(Boolean)
    : [];

  const bossTurns: BossTurn[] = Array.isArray(obj.bossTurns)
    ? obj.bossTurns
        .map((t: any) => {
          if (!t || typeof t.prompt !== 'string') return null;
          const insBlock = t.insert ? blocks(t.insert.block) : undefined;
          return {
            prompt: String(t.prompt),
            thinking: Array.isArray(t.thinking) ? t.thinking.map(String) : ['整理中…'],
            answer: String(t.answer ?? ''),
            insert: insBlock ? { label: String(t.insert.label ?? ''), block: insBlock } : undefined,
          };
        })
        .filter(Boolean)
    : [];

  const historyNames: string[] = Array.isArray(obj.historyNames)
    ? obj.historyNames.map(String).filter((s: string) => s.trim().length > 0)
    : [];

  if (!readingInserts.length && !bossTurns.length) return null;
  return { id, name: obj.name.trim(), readingInserts, bossTurns, historyNames };
}

const GENERIC_HISTORY = ['工作会话', '资料整理', '方案讨论', '文档撰写', '数据核对', '邮件往来'];

/** Profession-specific fake 历史对话 title for a sidebar row (boss mode). */
export function bossHistoryName(prof: Profession, index: number): string {
  const pool = prof.historyNames.length ? prof.historyNames : GENERIC_HISTORY;
  return pool[index % pool.length];
}

/** The prompt a user copies, pastes into another AI, and gets importable JSON back. */
export function buildGeneratorPrompt(profession: string): string {
  const name = profession.trim() || '【在这里填写你的职业,例如:律师 / 医生 / 建筑设计师 / 同声传译】';
  return `你是一个 JSON 生成器。请根据我的【职业】,生成一段"摸鱼伪装"用的工作内容数据,用于一个伪装成 AI 助手的小说阅读器。严格输出符合下面 TypeScript 类型的【纯 JSON 对象】,不要输出任何多余文字,不要用代码块或反引号包裹。

我的职业是:${name}

类型定义:
type Profession = {
  id: string;          // 英文短 id,如 "lawyer"
  name: string;        // 中文职业名,如 "律师"
  readingInserts: {    // 阅读时穿插的"小工作产出",请给 4~5 条
    label: string;     // 顶部灰色小标题,像在操作某个文件,如 "更新 答辩状.docx"
    note: string;      // 一句话说明你刚做了什么,如 "补充了管辖权异议的论据"
    block: Block;      // 工作产出块,见下
  }[];
  bossTurns: {         // 老板突然出现时展示的完整工作问答,请给 4~6 条
    prompt: string;    // 你向 AI 提的工作问题
    thinking: string[];// 2~3 行简短的思考过程
    answer: string;    // AI 的回答,可用 \\n 换行,可用 **加粗**、\`行内代码\`
    insert?: { label: string; block: Block };  // 可选:回答后附带的工作产出
  }[];
  historyNames: string[];  // 5~6 个,伪装时侧边栏"历史对话"里显示的工作会话标题,如 "需求评审纪要"
};
type Block =
  | { kind: "table"; title: string; headers: string[]; rows: string[][] }
  | { kind: "list";  title: string; ordered?: boolean; items: string[] }
  | { kind: "doc";   title: string; paragraphs: string[] }
  | { kind: "code";  title: string; lang?: string; lines: string[] }
  | { kind: "diff";  fileName: string; lines: { type: "add"|"del"|"ctx"; text: string }[] };

要求:
1. 内容要专业、真实、像真的在认真工作,符合该职业的日常术语;
2. block 优先用 table / list / doc(diff 和 code 只适合程序员、数据等技术岗);
3. historyNames 给 5~6 个,要像该职业真实的工作会话标题(简短、4~8 字);
4. 只输出 JSON 对象本身,从 { 开始,到 } 结束。`;
}
