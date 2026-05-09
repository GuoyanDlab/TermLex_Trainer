# TUI Qwerty Learner

一个运行在终端里的英文训练器（TUI），以单词逐字输入训练为主，以间隔重复为复习调度，单词高频真实场景句子训练强化的工具，另附有高频chunks磨耳训练语感模式。

本项目基于 TypeScript + Node.js + neo-blessed 构建，不是网页应用，不依赖 React/Ink，而是一个可常驻终端交互的学习程序。

## 快速开始（30秒）

```bash
git clone <你的仓库地址>
cd TUI_qwerty
corepack enable
pnpm install
cp  .env
pnpm run dev
```

启动后可先这样体验：

- 在左侧词库区按 `j/k`（或 `↑/↓`）选词库，`Enter` 加载
- `Tab` 切到右侧开始练习
- `Ctrl+Y` 打开单词 YouGlish，`Ctrl+O` 打开 Chunk Radio
- `q` 退出

## 产品定位

- 终端内高频训练英文单词与语块
- 左侧词库选择，右侧任务练习，底部状态栏提示
- 基于记忆阶段与到期调度，不是简单顺序刷词
- 支持发音、句子播放、YouGlish 音频语境训练

## 功能概览

- 词库管理
- 自动读取 `json/*.json`
- 支持 `/` 搜索词库、`j/k` 或 `↑/↓` 选择、`Enter` 切换词库

- 训练任务（MVP）
- `copy_typing`
- `meaning_to_word`
- `word_to_meaning` + 自评（`again/hard/good`）

- 记忆系统
- 阶段：`new / encoding / learning / reviewing / mature / leech`
- 本地进度：`data/progress.json`
- 到期优先调度：learning/encoding/leech -> reviewing -> new -> mature

- 音频能力
- 单词发音：有道接口 + 本地缓存（`data/audio/`）
- 句子发音：ElevenLabs（可配置多音色轮播）

- YouGlish 单词模式
- 以当前单词作为 query 拉取语料片段
- 显示 phrase、clip 进度、翻译

- YouGlish Chunk Radio 模式
- query 来源：`chunks/chunks.json`
- 每条 chunk 自动播放，播到目标 clip 数后自动切下一条
- 若某条不足 20 clip，则播完该条最后一个 clip 自动切下一条
- 播到最后一条 chunk 后自动循环到第 1 条
- 支持手动上一条/下一条/跳转
- 退出模式时记录当前位置，下次从上次位置继续

## 核心设计原理

### 1) 词典数据清洗（输入可靠）

读取 `json/*.json` 后统一 normalize：

- `name` 缺失则跳过
- `trans`/`e_mean` 非数组时转空数组
- `usphone`/`ukphone`/`speech` 缺失转空字符串
- 同词库按 `name`（不区分大小写）去重
- `sentence` 支持从 `sentence` 或 `sentences[]` 兼容读取

对应代码：

- `src/dict/loader.ts`
- `src/dict/normalize.ts`

### 2) 训练状态机（任务驱动）

根据单词阶段生成任务类型与重复目标：

- `new` -> `copy_typing`
- `encoding/learning/reviewing/leech` -> `meaning_to_word`
- `mature` -> `word_to_meaning`

每轮输入都经过逐字符校验；错误轮不计入 repeat，正确轮才累计。

对应代码：

- `src/session/task.ts`
- `src/session/typing-engine.ts`
- `src/session/session.ts`

### 3) 记忆进度更新（可持续复习）

评分键 `a/s/d` 会更新：

- `stage`
- `spellingLevel` / `meaningLevel`
- `wrongCount` / `consecutiveCorrect`
- `nextSpellingAt` / `nextMeaningAt`

并持久化到 `data/progress.json`。

对应代码：

- `src/progress/progress-store.ts`
- `src/session/session.ts`

### 4) 到期调度（先练该练的）

每次选词优先从“已到期且更重要”的阶段选择，避免机械刷词。

对应代码：

- `src/progress/scheduler.ts`

### 5) 音频播放架构（本地缓存 + 回退）

- 单词：有道接口下载 mp3 到本地缓存，再播放
- 句子：ElevenLabs 合成并缓存，支持多 VOICE_ID 循环
- macOS 以 `afplay` 为主，必要时可回退 `say`

对应代码：

- `src/audio/voice-player.ts`

### 6) YouGlish Bridge（浏览器桥接）

- 用 Playwright 启动持久化浏览器上下文
- 注入 YouGlish widget，采集 snapshot（clip、phrase、状态）
- 具备超时重试、bridge 重启等自恢复能力

对应代码：

- `src/youglish/bridge.ts`
- `src/app.ts`

### 7) Chunk Radio（语块连续听力）

- 读取 `chunks/chunks.json`（字符串数组）
- 按 clip 进度驱动自动切换（不是按 caption 次数）
- 退出时保存 chunk 游标到 `data/chunks-progress.json`

对应代码：

- `src/chunks/loader.ts`
- `src/chunks/progress-store.ts`
- `src/app.ts`

## 环境要求

- Node.js 18+（推荐 20+）
- `pnpm`
- 推荐 macOS（当前音频播放路径对 macOS 最友好）
- 本地可用 Chrome/Chromium/Edge（用于 YouGlish bridge）

## 安装

```bash
git clone <你的仓库地址>
cd TUI_qwerty
corepack enable
pnpm install
cp .env.example .env
```

然后按需编辑 `.env`（至少建议配置 `ELEVENLABS_API_KEY`，用于句子高质量发音）。

## 启动与构建

开发模式：

```bash
pnpm run dev
```

构建并运行：

```bash
pnpm run build
pnpm start
```

句子补全工具：

```bash
pnpm run sentence:add -- <dictId> <word>
```

## 环境变量说明

请参考 `.env.example`，常用项：

- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_IDS`
- `ELEVENLABS_VOICE_NAMES`
- `ELEVENLABS_MODEL_ID`
- `YOUGLISH_BROWSER_CHANNEL`
- `YOUGLISH_BROWSER_PATH`
- `YOUGLISH_HEADLESS`
- `YOUGLISH_AUTO_NEXT`
- `YOUGLISH_AUTO_NEXT_GAP_MS`

## 键位说明

### 全局

- `Tab`：切换左右焦点
- `/`：词库搜索
- `Enter`：加载词库
- `q`：退出（非输入态）
- `Shift+Q` 或 `Ctrl+C`：退出
- `Ctrl+E`：为当前词查询并写入 sentence

### 训练模式

- 输入/释义提交：`Enter`
- 回放单词：`Shift+P`
- 静音开关：`Shift+M`
- 美音/英音切换：`Shift+U`
- 重载词库：`Shift+R`

### Rating 模式

- `a`：again
- `s`：hard
- `d`：good
- `e`：ElevenLabs 句子发音（按配置音色循环）
- `f`：默认句子发音
- `t`：翻译句子

### YouGlish 单词模式

- 打开：`Ctrl+Y`
- 关闭：`Esc` / `Ctrl+Y`
- 播放/暂停：`Space`
- 上一/下一 clip：`[` / `]`
- 翻译 phrase：`t`
- 重查当前单词：`r`
- 重启 bridge：`x`

### YouGlish Chunk Radio 模式

- 打开：`Ctrl+O`
- 关闭：`Esc` / `Ctrl+O`
- 播放/暂停：`Space`
- 下一/上一条 chunk：`n` / `b`
- 跳转到第 N 条 chunk：`j`（输入数字后回车）
- 上一/下一 clip：`[` / `]`
- 翻译 phrase：`t`
- 重查当前 chunk：`r`
- 重启 bridge：`x`

## 数据文件说明

- 词库来源：`json/*.json`
- 语块来源：`chunks/chunks.json`
- 单词进度：`data/progress.json`
- Chunk 续播进度：`data/chunks-progress.json`
- 音频缓存：`data/audio/`
- YouGlish 浏览器 profile：`data/youglish/profile/`

## 常见问题

### 1) YouGlish 出现 `ready-timeout-giveup`

通常不是“你断网”，而是浏览器 profile/widget 状态卡住。

建议顺序：

1. 在 YouGlish 面板按 `x` 重启 bridge
2. 仍无效时，删除一次 `data/youglish/profile/` 后重启

### 2) 为什么删 profile 后会恢复？

`profile` 是浏览器持久化目录，含 cookie/localStorage/service worker 等状态。
状态脏了会影响 player ready，删除后会重建为干净状态。

不需要频繁删除，只有在 `x` 重启也无法恢复时再删。

### 3) 非 macOS 没声音

当前 MVP 的播放路径以 macOS 为主，非 macOS 音频后端仍有待完善。
核心训练流程和 YouGlish 文本/控制不受影响。

## 目录结构

```text
src/
  main.ts
  app.ts
  types.ts
  env/
  dict/
  progress/
  session/
  audio/
  youglish/
  chunks/
  ui/
  tools/
chunks/
  chunks.json
json/
  *.json
data/
  progress.json
  chunks-progress.json
  audio/
  youglish/
```

## 当前版本范围（MVP）

已实现：

- 左侧词库列表 + 搜索 + 切换
- 右侧训练任务（copy_typing / meaning_to_word / word_to_meaning + rating）
- 逐字符校验 + repeat 机制
- 本地进度持久化
- 有道单词发音 + ElevenLabs 句子发音
- YouGlish 单词模式
- YouGlish Chunk Radio 模式

后续可扩展：

- `choice / dictation / exam` 任务
- 更完善的跨平台音频后端
- 更智能的 YouGlish profile 自愈策略
