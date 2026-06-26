<div align="center">

# ⚓ Berth

### _面向 AI 的任务驾驶舱。_

**以项目和任务为中心，组织每一个 Agent 会话，并驱动它们把事情做完。**

[![npm](https://img.shields.io/npm/v/@corusco/berth?color=2563eb&label=npm)](https://www.npmjs.com/package/@corusco/berth)
[![node](https://img.shields.io/badge/node-%E2%89%A520-43853d)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-ISC-blue)](#许可证)
[![platform](https://img.shields.io/badge/platform-macOS%20%C2%B7%20Linux-lightgrey)]()

[English](README.md) · [简体中文](README.zh-CN.md)

</div>

<!-- 项目主页可在此放置截图/动图：
<p align="center"><img src="docs/assets/cockpit.png" width="820" alt="Berth 驾驶舱" /></p>
-->

---

## Berth 是什么？

你早已不是只跑一个 AI Agent——而是同时跑着**几十个**：Claude Code、Codex、Coco，散落在机器上的每一个仓库里。
它们干的活是真实的，却无处安放：一墙终端标签页，记不住**属于哪个项目**、**对应哪个任务**、**还剩什么没做完**。

**Berth 就是那个把项目和任务放进驾驶位的驾驶舱。** 它是一个本地、单用户的 Web 应用，同时做两件事：

- **一个为 AI 而生的任务管理器**——项目、按状态分列的任务看板、每个任务的上下文文档，全部本地持有。
  任务不只是笔记：每个任务都能**启动一个 Agent**，把项目上下文交给它，并**跟踪到完成**。
- **一个覆盖所有 CLI Agent 的会话驾驶舱**——一条侧边栏统管你所有的 Claude / Codex / Coco 会话。
  搜索、置顶、按项目或工作目录分组，点击任意会话即可在浏览器内嵌终端里**实时恢复**。

组织的最小单位是**项目与任务**，而不是终端标签页。Berth 以**只读**方式读取每个 CLI 自己的会话存储，
绝不移动或改动你的会话——它只是给会话背后的人和项目一个安身之处。

```
   项目  ──▶  任务  ──▶  启动  ──▶  Agent 会话  ──▶  完成
  (主目录    (状态、    (注入项目   (Claude / Codex /    (进展同步
   + 文档)    优先级、   上下文)     Coco，在内嵌终端     回看板)
              详情文档)             实时运行，刷新不掉线)
```

> **核心无需账号、无需云、无需任何外部集成**——只需要你本就在用的那些 Agent CLI。
> 你的任务、项目、置顶、分组和文档，全部留在本机。

---

## 亮点

| | |
|---|---|
| 🗂️ **项目驾驶舱** | 每个项目都有主目录、按状态分列的任务看板、Markdown 上下文文档（编辑 + 实时预览）以及自己的会话——汇于一处。 |
| ✅ **AI 原生任务看板** | 看板任务支持可配置的状态与优先级。每个任务自带详情文档，并能驱动一个 Agent 去执行它。 |
| 🚀 **启动并驱动 Agent** | 输入提示词，选好 Agent / 目录 / 项目 → Berth 启动一个**注入了**项目上下文的全新 CLI 会话，并归属到该任务。 |
| 🖥️ **实时内嵌终端** | 点击任意会话即可在浏览器内恢复。切走或刷新时，Agent **仍在后台运行**——服务端常驻 PTY，重连即可回放完整滚屏。 |
| 🔎 **统一会话列表** | 跨 Claude Code / Codex / Coco 的去重列表。搜索、**置顶**、按项目或工作目录分组，把会话拖到任务上即可关联。 |
| 🔒 **本地优先 · 只读** | 任务/项目存于本地 SQLite，文档为纯 Markdown。Berth 只读 CLI 会话存储，绝不改动。 |
| 🔌 **可插拔数据源** | 可选地把任务看板与外部系统（如飞书多维表格）双向同步。严格按需启用；对应工具未安装时自动隐藏。 |

---

## 快速开始

```bash
npx @corusco/berth@latest start   # 无需构建，直接运行；自动打开 /app 上的 UI
```

这是**使用** Berth 最快的路径。Berth 是一个**本地服务 + 浏览器 UI**，在同一套核心之上提供多种形态——按需选择：

| 形态 | 适用场景 | 上手方式 |
|---|---|---|
| **CLI**（`berth start`） | 当作工具使用 | `npm install -g @corusco/berth` → `berth start` |
| **桌面应用**（Electron） | 想要双击即开 | `npm run electron:dev` |
| **源码运行（生产）** | 一条命令完整构建 + 运行 | `npm install && npm run prod` |
| **源码运行（开发）** | 开发 Berth 本身 | `npm install && npm start`（后端）+ `cd web && npm run dev`（SPA） |

> UI 是 **`/app` 上的 React SPA**——`berth start` 和桌面应用都会直接打开它，服务也会把 `/` 重定向到
> `/app`。`npm run prod` 是**一条命令**完成 SPA + 核心构建并由单进程统一提供服务。而 `npm start` 只是
> **开发后端**（不构建 SPA）——开发时请配合 `cd web && npm run dev` 跑前端热更新。

各形态共享 **`~/.berth`** 下的同一份状态——所以**别同时跑两个**（会争抢同一个 SQLite 库）。

<details>
<summary><b>CLI —— <code>berth start</code></b></summary>

```bash
npm install -g @corusco/berth
berth start                       # 在回环地址启动服务，并自动打开 UI
```

参数：`berth start --port <n> --host <h> --no-open`，以及 `berth --help` / `berth --version`。

> 服务**只绑定 `127.0.0.1`**（单用户、无鉴权）。`--host 0.0.0.0` 会把它暴露到局域网——**不安全**，
> 因为启动会话会以绕过权限的标志运行 CLI。

</details>

<details>
<summary><b>在任意 agent 里管理任务 / 项目 —— <code>berth skill install</code></b></summary>

Berth 是任务/项目的**权威数据源**（飞书多维表格等外部系统只是可选同步源）。可以用 `berth task` /
`berth project` 在终端管理；**更推荐**安装内置 skill，让任意 AI agent 帮你操作：

```bash
berth skill install               # 把 berth-tasks skill 安装到你所有的 agent
berth start                       # task 命令需要服务在运行
```

`berth skill install` 会调用跨 agent 安装器（`npx skills add`），同一份 skill 会装进
**Claude Code、Codex、Coco、Cursor、Gemini、Copilot…**——每个 agent 从各自的 `~/.<agent>/skills/`
读取。（若无法运行，则回退为把 skill **软链接**到本机已有的 agent 目录。）装好后，直接对 agent 说
*“新增待办 / 处理任务 / 查看待办”* 即可驱动 Berth。

没装 `berth` 包？也可以**只从 GitHub 装这个 skill**——无需账号、无需飞书登录，适用于任意
[`skills`](https://www.npmjs.com/package/skills) 支持的 agent：

```bash
npx skills add xiawenxing/Berth   # 克隆公开仓库，把 skills/berth-tasks 装进你所有的 agent
```

```bash
berth task add "<内容>" [--project P]       # 不带 --project 时由 AI 归类
berth task list [--status S] [--project P] [--json]
berth task done <id|标题>                   # 还有：status / set / progress / rm
berth task sync                            # 推送本地改动 + 拉取外部变更
berth project list | berth project add <名称>
```

> `berth task`/`project` 命令需要服务在运行（`berth start`）；若未启动，会明确提示如何启动（含正确的
> `--port`）。

</details>

<details>
<summary><b>桌面应用 —— Electron</b></summary>

```bash
npm run electron:dev              # 构建并启动应用（在树内重建原生模块）
npm run electron:release          # 或：在 release/ 产出安装包（macOS 为 .dmg）
```

> **跨平台打包：** `electron:release` 只产出**当前操作系统**的安装包——macOS 出 `.dmg`/`.zip`，
> Windows 出 `nsis` 的 `.exe`。在 **macOS 上构建 Windows 安装包**需要 wine/mono；实践中请在 Windows
> 机器或按目标系统分别用 CI 构建。

> **原生 ABI 注意：** `electron:dev` 会在树内为 Electron 重建原生模块（`better-sqlite3`、`node-pty`），
> 这会让 `npm test` / `npm start` 失效，需用 `npm run rebuild:node` 还原。`electron:release` 在
> 一次性 worktree 中构建，不影响你的开发树。
>
> _状态：已搭好脚手架；`.dmg` 构建尚未验证（需要带显示器的 Mac）。_

</details>

### 环境要求

- **Node 20+。**
- `PATH` 上至少有一个受支持的 Agent CLI：
  [`claude`](https://docs.claude.com/en/docs/claude-code)、`codex` 或 `coco`。Berth 是它们之上的驾驶舱，本身不打包它们。
- **原生依赖：** `node-pty` 与 `better-sqlite3` 是原生模块（macOS/Windows 有预编译产物）。
  **Linux** 下 `node-pty` 无预编译，`npm install` 会从源码编译——请先装好 `python3`、`make` 与 C++ 编译器
  （`build-essential` / `gcc-c++`）。

### 平台支持

- **macOS** —— 主力平台，完整测试。
- **Linux / Windows** —— 进行中。浏览器模式设计上可用，部分跨平台加固（二进制发现、非 macOS 的文件夹选择器、
  Windows 路径处理）仍在落地。

---

## 工作流

### 1. 导入你的会话
会话列表**初始为空**——Berth 不会扫描磁盘上的每一个 CLI 会话，而是让你**导入目录**，就像给项目指定工作目录一样：

- 在 **无归属** 区域点击 **导入目录**，选择一个文件夹。Berth 会拉入工作目录**正好是**该文件夹的会话
  （不含其子目录——子目录需单独导入）。创建带 cwd 的项目时也会自动导入该目录下的会话。
- **同步会话** 按钮会重新扫描已导入的目录，拉取新会话。

### 2. 建立项目
创建一个带主目录的项目。它会获得任务看板、Markdown 文档空间（应用内编辑 + 实时预览），并汇总该目录下的所有会话。

### 3. 用 Agent 驱动任务
往看板里加一个任务（状态、优先级、详情文档）。准备好后**启动**它：Berth 在所选 CLI 中启动一个全新 Agent 会话，
**注入**项目/任务上下文，并归属到该任务。Agent 在**内嵌终端**里运行，后台持续不断——切走、刷新、再回来，
重连到同一个活进程，滚屏完整。

### 4. 跟踪至完成
随着 Agent 推进，把任务在看板上流转。任务、文档、分组全部本地持有，无需任何外部服务。

---

## 核心概念

| 概念 | 含义 |
|---|---|
| **项目（Project）** | 一个工作单元，含主目录、任务看板、上下文文档与关联会话。 |
| **任务（Task）** | 看板卡片，带状态、优先级与自己的详情文档——也是那个能**启动并驱动 Agent** 的东西。 |
| **会话（Session）** | 一次 CLI Agent 运行（Claude / Codex / Coco），只读呈现，可在内嵌终端中实时恢复。 |
| **驾驶舱（Cockpit）** | 把项目、任务、会话串到一起的统一工作区。 |
| **数据源（Data source）** | 一个可选插件，把任务看板与外部系统双向同步。 |

---

## 可选集成（插件）

Berth 可通过可插拔的数据源适配器，把任务双向同步到外部系统。**这些都严格可选**——
对应工具未安装时 Berth 会自动隐藏该集成，核心照常工作。所有连接参数都存在本地配置里，绝不写进代码。

- **飞书（Lark）多维表格** —— 与飞书多维表格双向同步任务。需要 `PATH` 上有内部 `lark-cli` 工具；
  若不存在，则该集成禁用，Berth 其余部分不受影响。详情文档链接可选写成指向你自己 vault 的 `obsidian://` URL。
  在 **设置 → 数据源** 中配置。
- **Meego** —— 占位适配器，尚未实现。

> 首次运行的连接配置可由**本地、未跟踪**的 `~/.berth/seed.json`（或 `BERTH_SEED_JSON` 环境变量）种入。
> 全新安装初始为空，通过设置页配置数据源。

---

## 数据与隔离测试

Berth 自身的状态——SQLite 库、文档、首次运行种子、启动清单——都在 **`~/.berth`** 下。
若想在不碰真实数据的情况下运行（例如模拟空的首次启动），把 `BERTH_HOME` 指向一个临时目录：

```bash
BERTH_HOME=/tmp/berth-test npm start      # 在 /tmp/berth-test 下生成全新的任务/项目/设置
rm -rf /tmp/berth-test                     # ~/.berth 完全不受影响
```

`BERTH_HOME` 只迁移 Berth 的可写状态——你只读的 CLI 会话存储仍会被读取，所以**导入目录**照样能找到真实会话。
若想要完全干净的沙箱（连会话也没有），改为覆盖 `HOME`。

---

## 开发

Berth 基于 Node 20 + TypeScript（ESM）、`express` + `ws`、`node-pty`、`better-sqlite3`、`@xterm/xterm`。

- **`docs/ARCHITECTURE.md`** —— 模块地图、常驻 PTY 模型、数据模型、API 面、以及踩过的坑。
  改动启动/终端路径或数据层前，**先读它**。
- **`DEVELOPMENT.md`** —— 环境、构建、测试与工程约定。

```bash
npm start        # 准备前端资源 + 启动开发服务（tsx，无构建步骤）
npm test         # 单元测试（live 测试由 BERTH_LIVE=1 控制）
npm run build    # 为 CLI/Electron 形态产出 dist/（esbuild）
```

---

## 许可证

ISC。
