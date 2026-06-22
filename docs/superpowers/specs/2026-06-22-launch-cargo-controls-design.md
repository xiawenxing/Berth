# 起航货舱控件 — 设计稿

> 状态：待评审 · 日期：2026-06-22 · 分支：`release/berth-2.0-ia`
> 交互稿：`docs/superpowers/mockups/2026-06-22-launch-cargo-v2.html`

## 1. 目标

在 2.0 React 起航对话框（`web/src/components/LaunchDialog.tsx`）中恢复并重做"货舱"控件，让用户在启动会话时能够：

1. **三级上下文开关**：项目上下文 / 任务上下文 / 代码上下文，可分别开关（默认全开）。
2. **多目录装载**：勾选多个已登记目录，走 `--add-dir` 一起挂载给 agent。
3. **可清除/可选的启动目录**：在已勾选目录里点亮其一作为启动目录（进程 cwd）；不点亮则回退到"默认启动目录"（项目 workspace）。修复当前"只有 1 个已登记货舱时启动目录写死、无法清除"的死角。

全程遵循**渐进披露**：默认折叠成一条安静的摘要，直接点"起航"零打扰；想调才展开"高级"。

## 2. 现状与差距

当前 `LaunchDialog` 的"启动目录"段（`LaunchDialog.tsx:158-196`）：

- 0 个已登记货舱 → 静态"项目默认目录"。
- 1 个 → 静态单行，**无法切换或清除**（本次要修的死角）。
- ≥2 个 → 单选 radio。

没有任何上下文开关，也没有多目录 `--add-dir` 装载。后端调研结论（关键事实，决定哪些选项是真的）：

- **上下文当前是 always-on**：每次起航，若 `contextProtocolEnabled`，服务端把项目/任务元信息 + 维护规则打包成一个 inject 文件，经静默通道注入（claude `--append-system-prompt-file`；codex/coco SessionStart hook）。**没有 per-launch 开关。** 旧 UI 的勾选框是没接线的 `SAMPLE_CARGO` 占位。
- **`--add-dir` 通道已就绪**：`src/pty/launch.ts:70-106` 的 `freshArgv` 已支持 `addDirs`，但 `handleFresh` 今天只传 `addDirs:[docsRoot]`，项目目录从不挂载。`--add-dir` 是变长参数，定位 prompt 必须用 `--` 隔断（已有处理，见 launch.ts:72-83）。
- **单 cwd**：`/pty?new=1` 只读一个 `cwd`，空 cwd → 服务端 workspace 兜底（`pty-ws.ts:288-292`）。
- **登记目录的 API 已存在**：`POST /api/projects/add-path`、`POST /api/projects/path/toggle`。

## 3. 交互设计（前端）

定稿方向 = "A 的折叠模型 + C 的安静折叠条 + 统一目录列表（⚓ 点亮 = 启动目录）"。

### 3.1 折叠态（默认）

一条安静的灰色摘要条 + `高级 ⌄`，复用项目既有 dialog 风格：

```
货舱   上下文 3 项 · 启动 ~/code/berth · 装载 +1            高级 ⌄
```

- "上下文 N 项" = 当前打开的上下文开关数（项目/任务/代码）。
- "启动 xxx" = 当前启动目录；未点亮则灰字"默认"。
- "装载 +N" = 已勾选但非启动目录的额外挂载数（N=0 时省略该段）。
- 摘要随展开态里的选择实时刷新。

### 3.2 展开态（"高级"）

**A. 上下文注入**
- ☑ 项目上下文（Berth）— 独立开关，默认开
- ☑ 任务上下文 · 进展 N 条 — 独立开关，默认开；仅当目的地=任务时显示

**B. 代码上下文** — section 头上带一个主开关（三级里的第三级）
- 关掉整段 = 不装载任何代码目录：启动目录回退默认、无 `--add-dir`（目录列表置灰禁用）。
- 开启时显示统一目录列表：

```
代码上下文                                        装载 [开关]
勾选要装载的目录(走 --add-dir)；点行尾 ⚓ 设为启动选其一作为启动目录，不点则用默认启动目录。
┌────────────────────────────────────────────────┐
│ ☑  ~/code/berth                  [⚓ 启动目录]   │  ← 点亮(brand)
│ ☑  ~/work/berth-2.0              [⚓ 设为启动]   │  ← 已勾选未点亮(ghost)
│ ☐  ~/Obsidian/specs                             │  ← 未勾选(无⚓按钮、置灰)
└────────────────────────────────────────────────┘
+ 额外目录…
启动目录：~/code/berth        ← 实时；未点亮显示灰字"默认启动目录"
```

**统一目录列表语义**（取代旧的"单列启动目录 radio + 装载目录 checkbox"）：
- **勾选框** = 装载该目录（`--add-dir`）。
- **⚓ 设为启动** = 把该行设为启动目录（cwd），**单选**；只在已勾选的行出现。
- 再点已点亮的 ⚓ = 熄灭 → 回到"默认启动目录"（项目 workspace，`cwd=''`）。
- 勾选第一个目录时**自动点亮**为启动目录；取消勾选会一并熄灭（若熄灭的是当前启动目录，则回退默认，不自动改点别的）。
- **额外目录…** = 文本框填绝对路径（浏览器无法选服务端目录）；经 `POST /api/projects/add-path`（`enabled:true`）登记后，作为新行出现并默认勾选。

### 3.3 默认值与状态生命周期

- 打开对话框默认：上下文三项全开；代码上下文里**所有已登记 enabled 目录默认勾选**（恢复旧"默认装载已登记的目录"语义）；启动目录默认点亮 sticky `lastCwd`（命中已勾选时），否则第一个已勾选目录。
- ⚠️ **行为变化提示**：今天 agent 只拿到 `cwd + docsRoot`；本设计默认勾选所有已登记目录，会让 agent 看到更多目录。这是"装载目录回来了"的预期，但确实拓宽了 agent 可见面。
- 所有选择**每次起航重置**，不新增持久化；仅沿用现有 sticky `lastCwd`（real launch 后由服务端写 `project_last_cwd:<id>`）。

## 4. 数据流与契约变更

链路：`LaunchDialog`(构造 launch spec) → `Terminal.tsx`(拼 `/pty?new=1` query) → `handleFresh`(解析、建 manifest、spawn)。

### 4.1 `LaunchSpec`（`web/src/components/Terminal.tsx:7-15`）

新增字段（透传到 query）：

```ts
addDirs?: string[]          // 已勾选但非启动目录的额外挂载
ctxProject?: boolean        // 项目上下文开关
ctxTask?: boolean           // 任务上下文开关
// 代码上下文开关无需独立字段：关 → cwd='' 且 addDirs=[]（隐式编码）
```

`cwd` 字段复用既有：= 点亮的目录；未点亮或代码上下文关 → `''`。

### 4.2 `/pty?new=1` query 参数

- `cwd`（既有）：点亮目录，空 → 服务端 workspace 兜底。
- `addDirs`（新）：可重复参数 `&addDirs=...&addDirs=...`，服务端**逐个校验须在该项目已登记 enabled 的 pathsMeta 内**（拒绝任意路径挂载；额外目录因走 add-path 已登记，天然在内）。
- `ctxProject` / `ctxTask`（新）：`0`/`1`；**缺省 = 开**（向后兼容：旧客户端/无参数 = 当前 always-on 行为）。

`Terminal.tsx` 在拼 query 处（约 139-143 行）追加上述参数。

### 4.3 `handleFresh`（`src/server/pty-ws.ts:274-455`）

1. 解析 `addDirs`（校验 against 该 project 的 enabled pathsMeta）、`ctxProject`/`ctxTask` 门控。
2. cwd 解析逻辑不变。
3. 门控 manifest 构建：
   - 两者皆关 → **完全跳过注入**：`injectFile=undefined`，不写 inject 文件、不设 codex/coco 的 `BERTH_CONTEXT_FILE`、docsRoot 也不进 addDirs。
   - 否则按门控建 manifest（见 4.4），inject 文件照旧。
4. spawn 的 `addDirs` = `用户校验后的 addDirs` + (`ctxProject||ctxTask` ? `[docsRoot]` : `[]`)。docsRoot 绑定"有任意上下文"，因为它是上下文文档库（Obsidian vault），属上下文而非用户代码目录。
5. `contextProtocolEnabled` 全局设置仍是总闸（关 → 无 ctxInjection，门控无意义）。

### 4.4 `buildManifest` / 门控（`src/agent/manifest.ts`、`pty-ws.ts:226-230`）

`buildManifest`（及其 `ManifestInput`）新增 include 标志 `{ project: boolean; task: boolean }`：

- **task launch**：task 段（标题/状态/detail doc）受 `ctxTask` 门控；"Berth project scope" 段 + 项目 context doc 受 `ctxProject` 门控。
- **project launch**：project 段（todo 索引 + project scope）受 `ctxProject` 门控；无 task 段。
- 维护尾块（compactRules / contextDocPath / protocolPath）跟随"有任意上下文开"；两者皆关时整个注入已被 4.3 跳过。
- 纯函数特性不变；门控由 `handleFresh` 传入，`enrichManifestForContext` 透传标志。

### 4.5 `launch.ts`

`freshArgv`/`launchFresh` **无需改动** — `addDirs` 通道与 `--`/变长参数处理已就绪，仅由 `handleFresh` 多传项目目录。

## 5. 校验与安全

- `addDirs` 服务端逐个校验须在该 project 的 enabled pathsMeta 内，非法值丢弃并经 `ws.send` 提示（不阻塞起航，遵 §10 永不阻断）。
- 额外目录走既有 `add-path`（已含路径存在性校验）；只读环境/不可写不阻断起航。

## 6. 边界情形

- 0 个已登记目录 + 代码上下文开：列表空，仅"额外目录…"；启动目录显示"默认启动目录"。
- 取消勾选当前启动目录：熄灭 → 回退默认，不自动改点其它。
- 目的地=自由提问：不显示"任务上下文"开关；`ctxTask` 视为关。
- codex hook 探针未就绪/过旧：保持既有降级提示，门控不改变该路径。
- 校验剔除非法 addDir 后若启动目录(cwd)恰被剔除：cwd 回退 `''`（默认 workspace）。

## 7. 测试

- **manifest 门控**（`src/agent/manifest` 单测）：task/project × {project on/off, task on/off} 四象限，断言段落出现/缺失；两者皆关由 handleFresh 跳过（注入层测）。
- **handleFresh query 解析**：`addDirs` 校验（合法保留/非法剔除）、`ctxProject/ctxTask` 缺省=开、皆关→无 injectFile & docsRoot 不入 addDirs。
- **`freshArgv` 回归**：多 `--add-dir` + `--` 隔断 prompt（已有 `test/launch.test.ts:125-135`，补多目录用例）。
- **前端**：⚓ 单选/熄灭/勾选联动 cwd 与摘要的纯逻辑（抽成可测的 reducer/helper）。
- `npx tsc --noEmit` clean + `npm test` green 后再提交。

## 8. 涉及文件

- `web/src/components/LaunchDialog.tsx` — 货舱折叠块 + 统一目录列表 + ⚓ 机制（主要改动）。
- `web/src/components/Terminal.tsx` — `LaunchSpec` 字段 + query 拼接。
- `src/server/pty-ws.ts` — `handleFresh` 解析/门控/校验；`buildManifestInput`/`enrichManifestForContext` 透传标志。
- `src/agent/manifest.ts` — `buildManifest` include 标志。
- `web/src/lib/data.tsx`（若 add-path 调用未封装）+ 既有 add-path/toggle API 复用。
- 测试：`src/agent/*manifest*`、`src/server/*pty-ws*`、`test/launch.test.ts`，及前端 helper 单测。

## 9. 范围外 / YAGNI

- 不持久化 per-launch 选择（除既有 sticky `lastCwd`）。
- 不做服务端文件系统目录浏览器；额外目录靠手输绝对路径。
- 不动 `public/` 旧 1.0 UI（冻结）。
- 不引入新的全局上下文配置项；沿用 `contextProtocolEnabled` 总闸。
