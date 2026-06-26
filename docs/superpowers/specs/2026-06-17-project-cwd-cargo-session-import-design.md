# Berth 2.0 — 项目 cwd 自动分配 · 货舱启动 cwd · 会话粒度导入

> Status: design v2 (hardened after adversarial review — 7 blockers / 17 majors folded in) · Date: 2026-06-17 · Branch: `release/berth-2.0-ia`
> Mockup: `docs/mockups/berth-2.0/v8-cwd-cargo.html`

## 1. 问题背景

2.0 React app 当前的会话归集模型对不上产品预期：

- **导入是目录粒度的。** `CargoDefaults.tsx` 的「添加目录」走 `importDir(path)` → 写 `session_import_dir` → 该目录下**所有**会话浮现，再把勾选的 `attach` 到项目。用户要：登记某 cwd（货舱）**不**自动导入全部会话，只导入勾中的。
- **货舱是 sample 假数据。** `ProjectWorkspace.tsx:309` 传 `dirs={SAMPLE_CARGO}`（用户「怎么导入不了」的直接原因）；底下「添加目录」的 pickFolder→previewDir→import 流程其实是真的。
- **项目缺 cwd 登记入口。** `NewProjectDialog` 不收 cwd（虽然 `createProject`→`addProjectPath(...,true)` 在收到 cwd 时是能登记 home 的，见 api.ts:253），2.0 也没有任何地方调 `add-path`，所以实际上 `project_path` 一直空、`homeCwd` 实际为 null → `resolveCwd()` 退化到「会话众数 cwd」，新项目甚至起不了航。
- **没有项目默认工作区**：没选 cwd / 项目无登记 cwd 的会话无处可去（前端 `resolveCwd` 返回 `''`，被 `LaunchDialog` 的 noCwd 拦死）。

## 2. 目标 / 非目标

**目标**
1. 每个项目一个 Berth **自动分配的工作区 cwd**（兜底启动目录）。
2. 项目可登记**真实**货舱目录（cwd / worktree），每个带「默认装载」开关。
3. 起航 cwd 按货舱**自动解析**（无星标，自动点亮一个、可切换并记住）。
4. 导入改为**会话粒度**：登记货舱 cwd 不再自动浮现其全部会话；只浮现显式勾选导入的会话。「添加目录」可只登记、不导入。
5. **不破坏现有**：本机当前可见会话不消失（迁移 §9）；老 `public/` app 与 React「无归属」页继续可用。

**非目标（本轮不做）**
- `--add-dir` 多目录上下文授予：本轮 LaunchDialog 不再展示 sample 的 `--add-dir` 勾选块；**manifest 自带的 `addDirs`（`buildManifest`→`launchFresh`）保持不变**——deferral 只针对「用户在起航对话框里手选额外目录」，不是端到端关掉 `--add-dir`。
- i18n / 飞书同步：不触碰。
- 彻底删除 `is_home` 列 / `session_import_dir` 表 / `/api/session-dirs` 端点：保留（见 §5.4、§9 M5）。

## 3. 预期行为（用户原话规整）

1. 每个项目一个 Berth 自动分配的 cwd；起航没选 cwd 的会话落这里。该目录在**会话分组里可见但路径打码**（显示「项目默认目录」，不露真实磁盘路径），在**货舱登记里不可见**。
2. 项目里可配置**真实**货舱目录。
3. 起航时：装载 1 个 → 直接在该 cwd 下启动；装载 ≥2 个 → 自动点亮一个 / 用户可手动切换（小 icon 点亮）。
4. 没选任何 cwd，或项目下无任何登记 cwd → 会话在 #1 的 Berth 自动分配 cwd 下启动。

## 4. 概念与数据模型

### 4.1 项目默认工作区 cwd（新）
- 物理路径：`join(berthHome(), 'workspaces', projectId)`（即 `~/.berth/workspaces/<projectId>/`）。
- **完全由服务端解析与创建**（前端拿不到 `berthHome()`，不能拼路径——见 §6）。惰性 `mkdirSync(...,{recursive:true})`。
- UI 永远显示「项目默认目录」，**不露真实路径**（分组组头 + 起航对话框都打码）。
- 不进货舱登记表、无「导入」icon。
- 与**项目文档目录无关**：文档仍在 `docsRoot`（本机 = Obsidian vault `projects/<name>/index.md`）；workspace 只是 agent 跑代码的临时工作区。**文档目录不迁移、不搬移。**

### 4.2 `project_path` 增加 `enabled`（改）
现 schema：`project_path(project_id, cwd, is_home, PK(project_id,cwd))`。
- **新增列** `enabled INTEGER NOT NULL DEFAULT 1`（`ALTER TABLE ADD COLUMN`）。
- `enabled=1` = 起航默认 cwd 候选；`enabled=0` = 登记备用、不进起航默认。
- **`is_home` 保留**：继续承载 `homeCwd`（`allProjectPaths().home`、`GET /api/projects.homeCwd`、老 `public/app.js`）。新前端的启动 cwd 解析**不读 is_home**，改用 `enabled` + 粘性（§4.4）。`createProject(cwd)` 仍照旧 `addProjectPath(...,true)`。
- store 改 `addProjectPath(projectId, cwd, {isHome?, enabled?})`；新增 `setPathEnabled(projectId, cwd, enabled)`、`removeProjectPath(projectId, cwd)`。`allProjectPaths()` 返回项扩展为 `{cwd, isHome, enabled}`。

### 4.3 `session_import` 显式导入集（新）
- **新表** `session_import(session_id TEXT PRIMARY KEY)` = 「这个会话已显式纳入 Berth 可见集合」，会话粒度归集真相。
- store 方法：`addSessionImport(id)` / `removeSessionImport(id)` / `allSessionImportSet(): Set<string>`。
- 写入时机：① 导入清单勾选确认（面板④）；② Berth 起航绑定到真实 id 后（见 §4.5）。

### 4.4 主 cwd = 粘性（新，替代星标）
- 新增 `app_setting` 键 `project_last_cwd:<projectId>`（复用 `getSetting/setSetting`）。
- 起航成功后写入**实际启动 cwd**，**仅当它是真实货舱**（不是 workspace 兜底）。**project 删除时清除**该键（`deleteProject`）。
- 起航自动点亮规则：`project_last_cwd`（若仍是 enabled 货舱）→ 否则第一个 enabled 货舱。用户切换 → 本次生效并写回。

### 4.5 Berth-launched 会话的浮现（替代 launch_intent.cwd 作根）
- 新增 store 方法 `allBoundLaunchSessionIds(): Set<string>` = `SELECT session_id FROM launch_intent WHERE bound=1 AND session_id IS NOT NULL`。
- 这批 id 并入 curated 集（§5.1），使 Berth 起的会话（含 codex 经 reconcile `bindIntent` 后）**必然可见**，无需把整个 launch_intent.cwd 当目录根。
- **不另在 reconcile 写 session_import**（避免双源）；codex 浮现 = `bindIntent` 后进 `allBoundLaunchSessionIds`，下一次 refresh 生效（已被上一轮「起航后 resync×3」覆盖）。

## 5. 归集模型变更（核心，比初稿更小）

### 5.1 curated 集（改 `curatedSessionIds`）
```
curatedIds = pin ∪ {attach 且 projectId 非空} ∪ edge ∪ session_import ∪ allBoundLaunchSessionIds
```
`src/sessions.ts:curatedSessionIds` 增两个入参（session_import 集、bound-launch 集）；`store-singleton.curatedSessionIds()` 传入新 store 方法。

### 5.2 浮现根（改 `importRoots`）——只删两项
`filterImportedSessions(sessions, roots, curatedIds)` **签名不变**。只改 `store-singleton.importRoots()`：
```
旧: session_import_dir ∪ project_path.cwd ∪ launch_intent.cwd
新: session_import_dir            ← 只保留这一个
```
- **删除** `project_path`（货舱不再浮现全部 ✓ 用户核心诉求）与 `launch_intent.cwd`（改走 §4.5 的 bound-intent 会话粒度）。
- **保留** `session_import_dir` 作根 → 老 `public/app.js` 的「导入目录」继续生效（blocker：兼容老 app）；React「无归属」页的目录导入也可走它（§7）。
- 因签名不变、只少两个根，`sessions.ts` 的 `filterImportedSessions` 本体零改动，回滚安全。
- **`refresh()` 必须把 UNFILTERED 全量扫描喂给 `reconcileLaunchIntents`**（不是过滤后的 cache）：新起的 codex 会话 bound=0/未 attach/未 import、cwd 又不再是根 → 不在 cache 里；若给 cache，reconcile 永远找不到它 → 永不 `bindIntent` → 永不浮现（死锁）。reconcile 内部已按 intent cwd/cli/time 约束候选，喂全量安全；绑定后下次 refresh 经 `allBoundLaunchSessionIds` 浮现。

### 5.3 会话分组（项目工作区）
- 仍按真实 `s.cwd` 聚合。显示组 = 项目默认工作区组（masked）∪ 该项目可见会话的真实 cwd 组。
- `CwdGroup` 类型新增 `kind: 'workspace' | 'cwd'`（`web/src/lib/types.ts`）。`ProjectWorkspace` 派生分组时，把 cwd === workspace 路径的组标 `kind:'workspace'`；`SessionModule` 据此：渲染「项目默认目录」masked 标签 + 紫 tag、**且不渲染导入 icon**；`kind:'cwd'` 组才有导入 icon。
- 「主/worktree·第 N」标签：主 = `project_last_cwd`/第一个 enabled 货舱所在组，否则会话最多组（兜底）。

### 5.4 「无归属」(Unassigned) 页（新增说明，原稿漏）
- 该页按 raw cwd 给**所有 project-less 可见会话**分组，源自 `GET /api/sessions`。新模型下 project-less 会话浮现 = `session_import ∪ pin ∪ bound-intent ∪ (cwd∈session_import_dir)`。**这是预期**：登记货舱不会让无归属页冒出该目录全部会话。
- 现有「导入目录」按钮（`Unassigned.tsx:115`）是**无 onClick 的死桩**。本轮**接活**：pickFolder → previewDir → 面板④清单 → `importSessions(ids)`（**不带 projectId** = 纯无归属导入，写 session_import 不 attach）。

## 6. 起航 cwd 解析（服务端权威）

前端不再尝试拼 workspace 路径。解析分两段：

**前端（`resolveLaunchCwd`，提取为 `web/src/lib/launch-cwd.ts` 共用于 ProjectWorkspace + Now）：**
```
1) 对话框选中的 enabled 货舱 cwd（≥2 时可选；默认点亮 project_last_cwd/第一个 enabled）
2) 否则唯一 enabled 货舱
3) 否则 ''（交给服务端兜底）
```
- `LaunchDialog` 的 `noCwd` **不再拦截**：当 cwd 为空但有 projectId 时，提示「将在项目默认目录启动」，照常起航（query 带空 cwd + projectId）。

**服务端（`handleFresh`，pty-ws.ts）：**
- 放宽空 cwd 守卫（现 `if(!cwd){...missing cwd...;close}`，pty-ws.ts:242-244）：`cwd 为空 && projectId 存在 → cwd = join(berthHome(),'workspaces',projectId)`；仍为空才拒绝。
- 抽 `ensureLaunchCwd(cwd)` 助手：当 cwd 落在 `berthHome()/workspaces` 前缀下 → `mkdirSync(recursive)` 并返回；否则保持 `existsSync(cwd)?cwd:homedir()`。**`launchFresh` 与 `resumeSession` 都调用它**（两处都有 `existsSync?...:homedir()` 静默回退的坑，launch.ts:30、106）。
- 起航成功后：`cwd` 非 workspace 前缀时写 `project_last_cwd:<projectId>=cwd`。

## 7. UI 变更（对应 mockup 四面板）

### 面板① 会话模块（`SessionModule.tsx` + `ProjectWorkspace.tsx`）— 注意：基本是新增
`SessionModule` 现无导入 icon、无 masked 组、无 previewDir。本轮加：
- 顶部 `kind:'workspace'` 组：紫 *Berth 工作区* tag、组头「项目默认目录」**不露路径**、**无导入 icon**。
- `kind:'cwd'` 组组头右侧**导入 icon** → `previewDir(该cwd)` → 面板④（导入到本项目）。

### 面板② 货舱登记（`CargoDefaults.tsx` + 真数据）
- `dirs` 改为来自 `GET /api/projects` 的 `pathsMeta`（见 §8），**删除 `SAMPLE_CARGO`**。
- 每行：路径 + **开关**（沿用 `<Toggle>`，持久化 `setPathEnabled`）+ 移除（`removeProjectPath`）。无星标。
- 「添加目录」→ pickFolder → previewDir → 面板④。

### 面板③ 起航对话框（`LaunchDialog.tsx`）
- 「启动目录」三态（§6）：0 enabled→项目默认目录（静态提示，不拦）；1→唯一货舱（静态）；≥2→单选，自动点亮粘性，可切换。
- 移除 `SAMPLE_CARGO` 的「代码上下文」勾选块（§2 非目标）。

### 面板④ 导入清单（改造 `ImportDialog`）
- **紧凑行**；**近期 8 + Show more（每次 +8）**：`previewDir` 返回全集（**须解除 200 cap**，见 §8），前端按 updatedAt 倒序分页渲染。
- 顶部 **全选/全不选作用于全集 M**（含未展开）；实时「已选 N / 共 M」。
- **默认全不选**（`useState(()=>new Set())`，**反转**现有 `ImportDialog.tsx:61` 的默认全选；`allOn` 改为相对全集 M 判定）。
- **两入口两语义**：
  - **货舱「添加目录」**：确认**总是** `add-path(id, cwd, {enabled:1})`（登记是主操作）+ 选中则 `importSessions(ids, projectId)`。按钮：选 0 →`仅登记目录`；选 N →`登记并导入 (N)`。空目录也照常登记。
  - **cwd 组导入 icon**：目录已登记 → 纯 `importSessions(ids, projectId)`。按钮 `导入选中 (N)`，选 0 禁用。
  - **无归属页导入目录**：`add-path` 不调（无项目）；`importSessions(ids)` 不带 projectId。
- 导入 = 选中会话 `addSessionImport` +（带 projectId 时）`attach`；未选留「无归属」，目录登记照常。

## 8. API 变更（`server/api.ts` + `lib/api.ts`）

- `GET /api/projects`：**保持 `paths: string[]` 不变**（老 `public/app.js`/旧 `ApiProject` 仍读 string[]），**新增** `pathsMeta: {cwd, enabled}[]` + 保留 `homeCwd`。
- `POST /api/projects/add-path { id, cwd, enabled? }`（已存在，加 `enabled` 默认 1；不再依赖 isHome 语义但仍可传）。
- `POST /api/projects/path/toggle { id, cwd, enabled }`（新）→ `setPathEnabled`。
- `POST /api/projects/path/remove { projectId, cwd }`（新）→ `removeProjectPath`。（用 POST + 两段路径，避免被 `DELETE /projects/:id`（:id="path"）抢匹配。）
- `POST /api/session-import { ids: string[], projectId? }`（新）：`addSessionImport(每个 id)` +（带 projectId）`attach`；末尾 `refresh()`（与 `/session-dirs` 一致，服务端重扫）。`ids` 可空（仅登记目录时前端只调 add-path）。
- `POST /api/session-dirs/preview`：**解除 `PREVIEW_CAP=200`**（或显著提高 + 服务端分页）；面板④需全集做「全选含未展开 / 共 M」。
- 前端 `lib/api.ts` 增 `addPath/togglePath/removePath/importSessions`；`CargoDefaults`/面板④ 改真数据，`onConfirm` 不再调 `importDir`；`ProjectWorkspace` 的 `<CargoDefaults onDone={...}/>` 由 `reload` 改 `resync`（或依赖 session-import 端点已 `refresh()`，二选一，务必有一处重扫）。
- 老 `importDir`/`/api/session-dirs` **保留**（老 app 用；React 新流程不再调）。

## 9. 迁移计划（用户明确要求）

全为**增量**（只加表/列/行），可回滚。沿用 `migrate-session-dirs.ts` 的「setting 守卫 + 跑一次 + 成功后才置标志」模式。统一在 `store-singleton.initData()` 调用，**顺序固定**：

- **M1 `project_path.enabled`**：守卫 `cols(db,'project_path').has('enabled')` 否则 `ALTER TABLE project_path ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1`（现有行默认 1）。`project_path` 的重建迁移（`migrateProjectRefs`，drop `name`）是自终止的，不会再 drop `enabled`。复用/导出 `cols()` 助手。
- **M2 `session_import` 表**：`CREATE TABLE IF NOT EXISTS session_import(session_id TEXT PRIMARY KEY)`（放在 `DATA_SCHEMA` 或 openStore 的 `db.exec`）。
- **M3 浮现连续性 `migrateSessionImportOnce`**（守卫 setting `session-import-migrated`）：
  - 输入用**真正的 `LogicalSession[]`**：`collectLogicalSessions(storeRoots())`（**不是** `store.allSessions()` 的 snake_case 行——那会让 `s.sessionId` 全 undefined）。
  - 用**旧规则**算当前可见集：`filterImportedSessions(all, OLD_importRoots, OLD_curatedIds)`，其中 `OLD_importRoots = session_import_dir ∪ project_path.cwd ∪ launch_intent.cwd`、`OLD_curatedIds = pin∪attach(real)∪edge`（即迁移前的逻辑）。
  - 对每个结果 `addSessionImport(s.sessionId)`。保证切到新模型后**当前可见集一个不少**（本机约 130 可见）。
  - 幂等；**成功跑完整循环后**才 `setSetting('session-import-migrated','1')`（中途异常则下次重试，不半迁移锁死）。
  - 顺序：M1 → M2 → 既有迁移（identity/assets/session-dirs）→ **M3**；M3 不依赖 `refresh()` 已跑（自带磁盘扫描）。
- **M4 项目默认工作区**：无数据迁移，惰性建。现有项目会话已按真实 cwd 分组，不受影响。
- **M5 `session_import_dir` 保留为根**（不退役）：兼容老 `public/app.js` 与无归属页目录导入。后续若废弃老 app 再单独清理。
- **M6 `project_last_cwd`**：无迁移；首启写入，缺省走第一个 enabled 货舱。
- **文档目录不迁移**：项目文档继续在 `docsRoot`（vault `projects/<name>/`）；workspace 是新增、与文档解耦，无搬移、无冲突。
- **回滚**：仅增表/列/行；代码回退到旧 `importRoots`（含 project_path/launch_intent）数据仍可用。

## 10. 测试

- `test/sessions.test.ts`：`curatedSessionIds` 纳入 session_import + bound-launch；`filterImportedSessions` 行为不变。
- `test/store.test.ts`：`enabled` 默认值 / `setPathEnabled` / `removeProjectPath`；`session_import` CRUD；`allBoundLaunchSessionIds`；`allProjectPaths` 返回 `{cwd,isHome,enabled}`。
- `test/migrate-session-import.test.ts`（新）：M3 用旧规则 seed → 断言旧可见集 ⊆ session_import（**真实 id**）；幂等；**前向回归**：project_path-cwd 下、未 import 的会话切换后**不**浮现（固化破坏性变更）。
- `test/store-singleton`/`reconcile`：bound codex 起航经 reconcile 后进 `allBoundLaunchSessionIds` → 可见。
- 服务端 cwd 解析单测：`ensureLaunchCwd`（workspace 前缀建目录 / 普通 cwd existsSync 回退）+ handleFresh 空 cwd+projectId → workspace。**这是关键可测点**（放服务端）。
- 前端 `resolveLaunchCwd`：提到 `web/src/lib/launch-cwd.ts` 纯函数；无前端测试框架 → 至少 `tsc` 覆盖类型，逻辑靠手测（起航三态 / 导入 8+showmore / 全选含未展开 / 默认全不选 / 仅登记目录）。
- API：add-path(enabled)/toggle/remove/session-import(+attach,+refresh)/preview 解 cap。
- 提交前：根 `npm test` 绿 + `npx tsc --noEmit` 干净 + `web` `npm run build` 绿。

## 11. 待确认 / 已定的默认

- **默认全不选**（采用；会话可能极多）。这是对现有「默认全选」的**行为反转**，已在 §7④ 标明。
- **老 `public/` app 继续支持**（采用；靠 §5.2 保留 `session_import_dir` 作根，零改动老 app）。
- **无归属页接活导入**（采用；接现有死桩按钮）。
- **`is_home`/`homeCwd` 保留**（采用；新启动逻辑不读它，但 API/老 app 仍用）。
- **codex 浮现时机**：经 reconcile `bindIntent` 后下一次 refresh 生效（已被起航后 resync×3 覆盖）。
