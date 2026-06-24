# 导入会话 chooser — 多入口导入对话框

**Date:** 2026-06-24
**Status:** Approved (design)
**Frontend:** `web/` (Berth 2.0) · **Backend:** `src/server/api.ts`

## Problem

无归属会话页顶栏的「导入目录」按钮（`web/src/pages/Unassigned.tsx` 的 `FolderInput` 按钮）目前直接弹出
原生文件夹选择器，只支持「按 cwd 选目录导入」一种方式。用户希望先弹一个**选择入口的对话框**，提供多种导入
方式，降低发现成本——尤其是「一键看某个 CLI 的全部会话并挑选导入」。

## 关键事实（调研结论）

- **桌面端 app（`Claude.app` / `Codex.app`）没有可导入的本地转录文件。** 两者都是 Electron 套壳的 web 应用
  （claude.ai / OpenAI），会话数据在 Chromium Local Storage / IndexedDB leveldb 里、且本质是云端账号同步；
  其 Application Support 目录下 `.jsonl` 转录数为 0。因此无法像 CLI 那样扫描"桌面 app 会话目录"。
- 本地**唯一可导入**的会话转录是 CLI / 本地 agent 存储，正是 `storeRoots()` 已在扫的三处：
  - Claude Code → `~/.claude/projects`
  - Codex CLI → `~/.codex`（`sessions/` 等）
  - Coco → `~/Library/Caches/coco`
  - 注：在 Claude 桌面 app 里跑本地 Claude Code（agent 模式）的转录也落在 `~/.claude/projects`，会被纳入；
    纯云端聊天不会。
- 因此「导入 Claude / Codex 会话」两个入口指向上述 **CLI / 本地 agent 存储**（决策：改指 CLI/本地 agent 存储）。

## Goal / Acceptance

点击「导入目录」按钮 → 弹出 **chooser 对话框**，含 5 个入口：

1. **导入 Claude 会话** — 预览 `~/.claude/projects` 全部 Claude 会话，**按 cwd 分组**、勾选导入
2. **导入 Codex 会话** — 同上，Codex（`~/.codex`）
3. **导入 Coco 会话** — 同上，Coco（`~/Library/Caches/coco`）
4. **选择导入路径** — 现有原生选择器 → 按 cwd 预览 → `ImportDialog`（**保持不变**）
5. **按会话 ID 导入** — 粘贴一个/多个 session id → 跨所有 store 查找 → 展示「找到 / 未找到」→ 导入找到的

导入统一落到既有的 `POST /session-import {ids}`（按 id 导入，已存在）。`BERTH_TEST_HOME` 不涉及；当
`BERTH_HOME` 隔离实例运行时，因 `storeRoots()` 仍走真实 home，这些入口照常扫到真实会话。

## 作用域

- 仅替换**无归属会话页顶栏**的「导入目录」按钮行为（`Unassigned.tsx`）。
- 项目内 `SessionModule` 的「导入其他目录」「导入该目录会话」**保持不变**（语境不同：导入进某项目货舱）。
- Settings 页的「导入目录」按钮（`Settings.tsx`，当前为占位）不在本次范围，后续可复用同一 chooser。

## Backend（`src/server/api.ts`）

两个新只读预览端点 + 复用既有导入端点。预览端点都用与现有 `/session-dirs/preview` 完全相同的扫描源
`collectLogicalSessions(storeRoots())`，不改扫描逻辑、不写状态。

- **`POST /sessions/preview-by-cli` `{cli}`** — 校验 `cli ∈ {claude,codex,coco}`，返回该 CLI 的全部会话，
  按 `updatedAt` 倒序，字段同 `PreviewSession`（`sessionId, cli, title, cwd, updatedAt`）。前端按 `cwd` 分组。
- **`POST /sessions/preview-by-ids` `{ids:string[]}`** — 在全部 store 的扫描结果中查这些 id，返回
  `{ found: PreviewSession[], notFound: string[] }`，供 ID 入口在导入前做「找到/未找到」确认。
- 复用 **`POST /session-import` `{ids}`** 执行导入（无 projectId → project-less，进无归属）。

性能说明：`collectLogicalSessions(storeRoots())` 本就扫描全部三个 store（现有 per-cwd 预览也这么做），
preview-by-cli 只是在结果上按 cli 过滤，成本与现状一致；codex 会话量大（~1k+）时标题扫描有秒级开销，属既有特性。
codex 的 `import-backups/` 等去重由现有 adapter / `collectLogicalSessions` 负责，本设计不改动。

## Frontend（`web/src/`）

- **`components/ImportChooser.tsx`** — chooser 对话框（`Dialog`），5 个入口竖排为可点条目（icon + 标题 + 副标题）。
  纯路由 UI：点选后调用回调，由 `Unassigned.tsx` 决定打开哪个后续对话框。
- **`components/CliImportDialog.tsx`** — 按 cwd 分组的导入对话框：
  - 顶部：CLI 名 + 总会话数 + 全局「全选（含未展开）」+ 搜索框（按 title/cwd 过滤）；
  - 主体：每个 cwd 一个可折叠分组头（cwd 路径 + 该组会话数 + 组级全选），组内是会话行；
  - 会话行复用从 `ImportDialog` 抽出的 **`SessionPickRow`**（checkbox + CliBadge + 标题 + relTime），两处渲染一致；
  - 确认 → `api.importSessions(ids)`（即 `POST /session-import`）。
- **`components/ImportByIdDialog.tsx`** — 文本域粘贴 id（换行/逗号/空格分隔）→ `preview-by-ids` →
  列出「找到」（默认全选，可取消）+ 标红「未找到」的 id → 导入找到的。
- **重构**：从 `ImportDialog.tsx` 抽出 `SessionPickRow`（及其勾选样式）为共享子组件，`ImportDialog` 与
  `CliImportDialog` 都用它，避免重复。`ImportDialog` 其余行为不变。
- **`lib/api.ts`** 增加 `previewByCli(cli)`、`previewByIds(ids)` 两个调用；`importSessions` 已存在则复用。
- **`pages/Unassigned.tsx`** — `onImportDir` 改为打开 `ImportChooser`；按所选入口分别打开
  `CliImportDialog` / 现有原生选择器流程 / `ImportByIdDialog`。

## 组件边界

```
导入目录按钮 (Unassigned 顶栏)
  └─ ImportChooser (5 entries)
       ├─ Claude/Codex/Coco → previewByCli(cli) → CliImportDialog(grouped) → importSessions(ids)
       ├─ 选择导入路径        → api.pickFolder → previewDir → ImportDialog (现有, 不变)
       └─ 按会话 ID 导入       → ImportByIdDialog → previewByIds → importSessions(found ids)
```

每个对话框自洽：拿到选中的 id 后交回 `Unassigned.tsx` 调 `importSessions` + `reload()`；对话框本身不直接改全局状态。

## 错误处理

- preview-by-cli：非法 `cli` → 400；扫描异常 → 空列表（对话框显示「没有可导入的会话」）。
- preview-by-ids：空 ids → 400；全部未找到 → 对话框仅显示未找到区、导入按钮禁用。
- 原生选择器取消 / 无 GUI → 维持现有 `{cancelled:true}` 行为，chooser 不报错。
- 导入是幂等的（`INSERT OR IGNORE`），重复导入无副作用。

## Testing

- 后端单测（`test/api.test.ts` 或新文件）：
  - `preview-by-cli` 仅返回指定 cli 的会话、含 cwd 字段、非法 cli → 400；
  - `preview-by-ids` 正确切分 found / notFound。
- 前端对话框是已验证端点之上的薄 UI；如有现成测试范式则加轻量交互测试，否则以后端单测 + 手动冒烟为准。
- 手动冒烟：点「导入目录」→ 选「导入 Claude 会话」→ 见按 cwd 分组列表 → 勾选导入 → 会话出现在无归属列表。
