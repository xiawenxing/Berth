# 已登记装载目录在项目会话列表常驻显示（即使无会话）

> Spec — 2026-06-26 · branch `release/empty-cargo-dirs-in-session-list`

## 问题

在项目工作台里，你可以登记一个 **装载目录（货舱 / `project_path`）**。但如果登记时该目录下没有任何
已归属本项目的会话，这个目录**不会出现在「会话（船只）」列表里**——因为会话列表完全由
「已归属本项目的会话按 cwd 分桶」推导得出（`ProjectWorkspace.tsx:157-197`），没有会话就没有分组。

它只出现在底部独立的 **「默认装载」** 注册区（`CargoDefaults`，`ProjectWorkspace.tsx:591`），而那里
**没有「从该目录导入会话」的入口**。每个 cwd 分组的「导入」(FolderInput) 图标只存在于会话列表的分组头
（`SessionModule.tsx:404-417`）。

结果：登记目录后，除了登记那一刻，**没有地方再从这个目录导入会话**——这正是用户反馈的痛点。

数据其实已经就绪：`project.pathsMeta`（`{cwd, enabled}[]`）已随项目下发到前端，
`ProjectWorkspace` 已在用它。所以这是一个**纯前端**的可见性问题，不需要后端 / API / 数据模型改动。

## 目标

让**所有已登记的装载目录**（不区分 `enabled`），在当前没有已归属会话时，仍以**空分组**常驻显示在项目
的「会话」列表中，并复用该分组头已有的「导入」图标作为后续导入入口。

## 非目标

- 不动「无归属」(Unassigned) 页——本需求明确只针对项目货舱场景。
- 不改后端、API、数据库、`session_import` / `session_import_dir` 语义。
- 不新增「登记目录」的触发机制——登记仍走现有 `addPath`（新建任务弹窗的 `onAddLaunchPath`、
  「导入其他目录」弹窗的「同时登记为装载目录」复选框）。本 spec 只解决**显示**。
- 不在空分组上提供「移除装载目录」操作——移除仍留在 `CargoDefaults` 区（已存在），保持改动最小。

## 设计

改动集中在两个文件，约 20 行。

### 1. `ProjectWorkspace.tsx` — `groups` useMemo（`:157-197`）

保持现有「按会话推导分组 + 计算主上下文」逻辑**完全不变**，在其**返回前追加**空货舱分组：

1. 先照旧用 `projSessions` 构建 `map`、计算 `mainCwd`、产出 `sessionGroups`（带会话的分组）。
   **主上下文必须在追加空目录之前计算完毕**——否则一个 `enabled` 的空目录可能被
   `enabled.find(c => map.has(c))` 误选为主上下文。（实现上：空目录不进入 `map`，只在最终数组尾部追加。）
2. 构造已被会话占用的 cwd 集合：`sessionCwds = new Set([...map.keys()].map(norm))`，
   其中 `norm(p) = p.replace(/\/+$/, '')`（与组件内既有 `norm` 一致——需把它提到 useMemo 之前可用，
   或在 useMemo 内用同义局部函数，避免 TDZ）。
3. 从 `project.pathsMeta` 取**全部**已登记目录，过滤掉：
   - 归一化后等于被遮蔽的 `workspaceCwd`（`ws`）的；
   - 归一化后已在 `sessionCwds` 里的（已有会话分组，避免重复；trailing-slash 容差靠 `norm`）。
4. 余下的每个目录，追加为一个空 `CwdGroup`：
   ```ts
   {
     key: p.cwd,            // 稳定 React key = 原始 cwd
     cwd: shortCwd(p.cwd),  // 展示用短路径
     tag: '装载目录',        // 右侧 pill
     shortTag: '装载目录',
     sessions: [],          // 空 → SessionModule 识别为空货舱组
     kind: 'cwd',
     rawCwd: p.cwd,         // 驱动分组头的「导入」图标 previewDir(rawCwd)
   }
   ```
   追加在 `sessionGroups` 之后（排在带会话分组的尾部）。

`groups` 已经只喂给 `<SessionModule>`，无其他消费方，所以追加是安全的。

### 2. `SessionModule.tsx` — `Section` 空态一行提示

`Section` 现已能正常渲染 0 行（不像 Unassigned 页的 `SessionGroup` 有 `if (length===0) return null`），
分组头、计数、导入图标都照常显示。只需在**展开且 `rows.length === 0`** 时，于 body 渲染**一行空态提示**：

> 该目录暂无项目会话 · 点 ⤵ 从磁盘导入

判定「空货舱组」用 `rows.length === 0` 即可——正常会话分组永远有会话，不会撞这个条件。
（如担心语义隐晦，可在 `CwdGroup` 增一个可选 `empty?: boolean` 显式标记；二选一，留给实现决定，
默认走 `rows.length === 0`。）

空分组的分组头：锚点图标 + 目录名 + 计数 `0` + `装载目录` pill + 导入图标。
**不**渲染分组级 ⋯ 菜单（`移出整组`/`取消导入整组` 对 0 会话无意义）——
即 `ProjectWorkspace` 给空组传的 `onDetachGroup`/`onUnimportGroup` 应为 `undefined`，
或 `SessionModule` 在 `rows.length === 0` 时不渲染该菜单。

## 数据流

```
project.pathsMeta (已下发) ──┐
                            ├─→ ProjectWorkspace.groups useMemo
projSessions ───────────────┘      ├─ sessionGroups（带会话，含主上下文）
                                   └─ + 空货舱组（pathsMeta 中无会话的目录）
                                          ↓
                                   <SessionModule groups={...}>
                                          ↓
                                   <Section rows={[]}> → 分组头 + 导入图标 + 空态提示行
                                          ↓ 点导入图标
                                   onImport(rawCwd) → api.previewDir → ImportDialog（既有流程）
```

## 边界 / 容差

- **Trailing slash**：登记目录与会话 cwd 可能差一个尾斜杠；全程用 `norm()` 比较，避免重复空组。
- **workspaceCwd**：被遮蔽的 Berth 默认工作区永远单独置顶显示，不应被当成空货舱组重复追加——过滤掉。
- **主上下文**：空目录绝不参与主上下文选取（在其计算之后才追加）。
- **`enabled` 无关**：未启用的登记目录同样显示空组（`enabled` 只影响起会话时是否默认装载）。

## 测试

- `ProjectWorkspace.groups` 的分组推导目前是组件内联 useMemo，无独立纯函数测试。本改动小且可在
  运行时验证；若实现时顺手把分组推导抽成可测纯函数更好，但非必须。
- 手动验证：登记一个无会话目录 → 它以空组出现在「会话」列表，展开有提示行，导入图标可打开
  `ImportDialog`；登记一个已有会话目录 → 不产生重复空组；带尾斜杠登记 → 不重复。
- `npx tsc --noEmit` clean + `npm test` green 后再提交。
