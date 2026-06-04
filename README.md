# FishReader 桌面客户端(Rust + Tauri)

伪装成 AI 助手「小豆」(豆包风格)的本地 TXT 小说阅读器。对话式 UI、`/` 唤起命令、老板键一键切换工作态 —— 让摸鱼看起来像在跟 AI 聊天。

## 🐟 FishReader 全家桶

FishReader 有**桌面客户端**和 **VS Code 插件**两种形态,书库格式与功能一致,挑顺手的用:

- 🌐 **官网**:<https://moyulao.cn/> — 下载、介绍、更新一站获取
- 💻 **桌面客户端**(本项目,Windows / macOS / Linux):伪装成豆包风格 AI 助手 → [wuuhw/fish-reader-client](https://github.com/wuuhw/fish-reader-client)
- 🧩 **VS Code 插件**:伪装成 Claude Code 代码审查 → [wuuhw/fish-reader-vscode](https://github.com/wuuhw/fish-reader-vscode)

> 在公司用 VS Code?→ 试试 [fish-reader-vscode](https://github.com/wuuhw/fish-reader-vscode) ·  更多请访问官网 [moyulao.cn](https://moyulao.cn/)

## 技术架构

| 层 | 实现 |
|---|---|
| 外壳 / 窗口 / 文件 IO / 编码检测 / 持久化 | **Rust(Tauri 2)** — `src-tauri/` |
| 引擎(解析/分页/搜索/状态)+ 命令 + 伪装 + UI | **Vanilla TS + 原生 CSS** — `src/` |
| 打包 | Vite(前端) + Tauri(出 `.dmg`/`.exe`/`.AppImage`) |
| 视觉 | 一比一对齐豆包桌面端:左侧栏(头像 + 假技能 + 历史对话)+ 右侧对话区,浅色主题 |

## 界面布局(对齐豆包桌面端)

**左侧栏**
- 顶部:头像 + 「豆包」+ 收起侧栏按钮
- `＋ 新对话 ⌘K` — 打开文件选择器导入一本 txt
- 假技能(纯装饰,可点选高亮):AI 搜索 / 帮我写作 / 图像生成 / AI 编程 / 收起
- AI 云盘(装饰)
- **历史对话 = 看过的小说库**:每条 `💬 书名`,点击打开;hover 出 `⋯` 菜单支持 **隐藏 / 删除**

**右侧对话区**
- 顶部标题(阅读时=书名;老板模式=「AI 搜索」)
- 用户消息:右对齐灰色气泡;助手消息:全宽纯文本(小说正文 / 假分析 / 假 diff)
- 底部输入框:`发消息、输入 @ 或 / 选择技能` + 深度思考按钮 + 圆形发送键

## 老板模式下的历史对话

进入老板模式时,**历史对话列表的书名会整体替换成假的工作会话名**(英语教学 / 量子研究 / MIT 最新研究 / SQL 查询优化…),`⋯` 菜单隐藏,点击历史条目只会再吐一条假工作问答而不会泄露小说。退出后还原真实书名。

### Rust 命令(`src-tauri/src/lib.rs`)
- `read_book(path, forced)` — 读取 txt + 编码检测(BOM → UTF-8 校验 → GB18030 兜底,`encoding_rs`),返回解码后的文本
- `load_state` / `save_state` — 进度/书签持久化到 app config 目录的 JSON(等价于 VSCode 的 globalState)
- `boss_window(action)` — 老板键的窗口级动作(minimize / hide / show / pin)

### 前端模块(`src/`)
- `engine/` — `parser` 章节切分、`paginator` 段落分页、`reader` 阅读游标、`search` 全文搜索、`state` 进度持久化
- `commands/registry.ts` — 斜杠命令注册 + 模糊匹配
- `disguise/` — `diff-generator` 假 diff、`snippet-pool` 六语言代码池、`thinking-animator` 假思考日志、`boss-mode` 预置工作问答池
- `ui/` — `dom` 豆包气泡渲染、`streaming` 流式打字
- `controller.ts` / `main.ts` — 编排与事件接线

## 支持的格式

- **TXT**(UTF-8 / GBK / GB18030 自动识别)
- **EPUB**(按 OPF spine 顺序解析章节,自带目录,比 txt 正则切章更准)
- **FB2**(FictionBook,按 `<title>` 切章)

EPUB/FB2 的解析是一套**纯 TS 解析器**(`src/engine/formats/`,用 `fflate` 解 zip),桌面端在 webview 里解析(Rust 只用 `read_bytes` 把原始字节递过来),与 VSCode 插件**完全同一套代码**,保证两端解析一致。`novels/示例.epub`、`novels/示例.fb2` 可直接拖进来试。

## 命令

```
/init <path>   关联本地 txt / epub / fb2(也可直接把文件拖进窗口)
/目录 /toc      章节列表
/下一页 /n      下一章(整章输出)
/上一页 /p      上一章
/跳转 N         跳到第 N 章
/搜索 X         全文搜索
/书签           add 名称 / list / jump 序号
/历史           切换最近读过的书
/设置           查看当前配置
/boss           手动进入/退出老板键
/恢复 /resume   退出老板键
/help           帮助
```

## 老板键(工作态)

桌面端没有「当前编辑器 tab」可读,默认动作为 **预置工作问答池**:切换瞬间清空对话,渲染一段看似真实的「AI 助手」工作问答(润色邮件、翻译、代码 review + 假 diff、解释概念等),头像变绿、状态变「工作中」。

触发方式:
- 快捷键 `⌘/Ctrl + Shift + B`
- 点击右上角 `⋯`
- 鼠标离开窗口(`mouseLeave`,可配延迟)
- 窗口失焦(`blur`,可配延迟)
- 命令 `/boss`

退出:再次快捷键 / `⋯` / `/恢复`,自动恢复到刚才阅读的章节。

> 也可在 `src/config.ts` 把 `bossAction` 改为 `minimize` / `hide`,改为窗口级隐藏。

## 开发

```bash
pnpm install                  # 装前端依赖(若内网源缺包,加 --registry=https://registry.npmjs.org/)
pnpm tauri:dev                # 启动开发(Vite + Tauri 窗口)
pnpm tauri:build              # 打生产安装包
```

仅前端调试(浏览器,文件读取走 File API 降级):

```bash
pnpm dev                      # http://localhost:5183
```

## 配置(`src/config.ts`,存 localStorage)

`charsPerPage` · `encoding` · `chapterRegex` · `maxChapterChars` · `fakeThinkingSpeed`
· `fakeDiff*` · `boss*`(触发方式、延迟、动作、假对话条数)· `avatarName`

## 与 VSCode 插件的差异

- 编码检测从 `iconv-lite`(Node)迁到 Rust 的 `encoding_rs`,逻辑等价
- 老板键内容从「读 active tab 生成」改为「预置工作问答池」(桌面无编辑器 tab)
- 视觉从 Claude Code 深色伪装改为豆包浅色风格
- 去掉了状态栏假 token 数(豆包无状态栏)
