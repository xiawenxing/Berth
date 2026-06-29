---
name: berth-tasks
version: 1.0.0
description: "Berth 任务/项目管理（Berth 为权威数据，飞书多维表格等只是可选同步源）。用 `berth task` / `berth project` CLI 在本地新增/更新/查询任务、改状态/优先级、记录进展、增删项目、触发同步。⚠️ '处理任务/处理一下/处理这个/完成了'默认按【更新已有任务】解读：先 `berth task list` 按标题反查，命中走更新，未命中再问用户或新增。触发：处理任务、处理待办、处理一下任务、新增任务、添加待办、记录待办、新增todo、加一条任务、更新任务、改状态、标记完成、关闭任务、记录进展、追加进展、查看任务、查待办、看下我的待办、本周任务、未完成任务、按项目分组、新增项目、归档项目、同步任务、把会话/当前会话绑定到任务、解绑会话、查看会话绑了哪个任务、berth task、berth project、berth session，以及 berth tasks / my tasks / task tracker / bind session to task 等等价英文表述。这是 personal-todo 的 Berth 原生替代。"
metadata:
  requires:
    bins: ["berth"]
---

# berth-tasks

管理 **Berth** 内部的任务与项目数据。Berth 的本地 sqlite 是权威存储；飞书多维表格 / Meego 等是**可选**同步源（通过 `berth task sync` 或 Berth 界面双向同步、冲突由用户解决）。所有命令通过 `berth` CLI 调用，CLI 会请求**正在运行的** Berth 服务的 REST API。

## 前置条件（每次操作前确认）

- `berth` 必须在 PATH 上。
- **Berth 服务必须在运行**（`berth start`，默认 `127.0.0.1:7777`）。若命令报“无法连接 Berth 服务”，告诉用户先运行 `berth start`（或用 `--port`/`$PORT` 指定端口），不要自行猜测改动数据。

## 路由速查

| 用户说的话 | 走哪 |
|---|---|
| 新增任务 / 记一条待办 / 加个 todo | `berth task add "<内容>" [--project P]` |
| 处理 X / 把 X 改成进行中 / 关掉 X / X 完成了 | **先** `berth task list` 反查 → `berth task done <ref>` 或 `berth task status <ref> <状态>` |
| 记录/追加进展 | `berth task log <ref> "<文本>"`（**追加**到任务上下文文档的「进展日志」，不覆盖） |
| 读/改任务上下文文档（背景/计划/TODO/决策） | `berth task doc <ref> --print` 拿路径+正文+协议路径 → 按协议用 Read/Edit 改对应小节 |
| 改标题/优先级/状态 | `berth task set <ref> [--title T] [--status S] [--priority P]` |
| 删除任务 | `berth task rm <ref>` |
| 查看 / 列出任务 | `berth task list [--status S] [--project P] [--json]` |
| 新增/查看/归档项目 | `berth project list` / `berth project add <name>` |
| 把当前/某个会话绑定到任务 | `berth session bind [<sessionId>] <ref>`（省略 sessionId=当前会话；运行中或已结束的会话都可绑） |
| 解绑会话 / 看会话绑了哪个任务 | `berth session unbind [<sessionId>]` / `berth session list [--task <ref>]` |
| 同步到飞书表格等外部源 | `berth task sync` |

`<ref>` 可以是任务 id、id 前缀（≥6 位）或标题子串。标题匹配到多个时 CLI 会列出候选并报错——这时向用户澄清，别瞎选。

## 核心规则

1. **更新优先**：“处理/改/完成/记录进展”默认是对**已有任务**操作。先 `berth task list`（必要时 `--json`）按标题反查；命中唯一→更新；命中多个→让用户挑；没命中→再确认是否新增。
2. **新增任务的项目归属**：`berth task add` 不带 `--project` 时服务端会用 AI 归类；若不确定会返回 needs-confirm 并给候选——把候选转述给用户，用 `--project <名称>` 指定，或 `--confirm` 建为无项目任务，或 `--project <新名> --create-option` 顺带建项目。
3. **状态/优先级取值**有限（在 Berth 设置里配置）。写错值服务端会报 `invalid status/priority`；不确定就先 `berth task list --json` 看现有取值，或让用户在 Berth 设置页确认。
4. **不要直接动数据库或外部表格**。一切经 `berth` CLI（服务端是唯一写入者，并负责同步）。
5. **结构与规则都以服务端为准，skill 不复制（避免漂移）**。每个任务有上下文文档 `tasks/<id>/index.md`（目标/背景=稳定段，计划/TODO 与 决策/风险=活跃段，外加追加型「## 进展日志」）。
   - 要看**确切结构** → `berth task doc <ref> --print`：正文里的 `<!-- 稳定/活跃/追加型 -->` 注释就是写入指引。
   - 要看**完整维护规则 + 「写到哪一段」分工** → Read `berth task doc` 输出里打印的「协议」路径（即 Berth docs root 的 `AGENTS.md`，可被 `projects/<name>/AGENTS.md` 覆盖）。这是规则的唯一真源，本 skill 不再内嵌一份。
6. **主动维护，别只记流水**。处理任务时按协议维护文档，不要等收尾才写：
   - **着手时**：`berth task doc <ref> --print` 看现状；活跃段为空就先把目标、背景、初步计划（`- [ ]` 列表）补齐。
   - **推进中**：明确了下一步 / 勾掉一项 TODO / 做了关键决策 / 发现风险时，**立即**用 Read/Edit 更新对应活跃段（不要囤到最后）。
   - **记进展**：`berth task log <ref> "<一句话>"`（追加到「进展日志」，不覆盖；Berth 自动滚动归档）。
   - **状态/优先级走 DB**：`berth task done/status/set`，不写进文档。
   - **不要手写短进展摘要（A）**：A 由 Berth 界面 ✨ 按钮按进展日志生成；skill 只维护文档正文 + 进展日志（B）。
7. **`berth task progress` 已废弃**：旧「覆盖式短进展」改为「追加式进展日志」。命中旧命令会报错并指向 `berth task log`。

## 命令参考

```
berth task                                  # = berth task list
berth task list [--status S] [--project P] [--json]
berth task add "<text>" [--project P] [--confirm] [--create-option]
berth task done <ref>                       # 置为“完成”类状态
berth task status <ref> <status>
berth task set <ref> [--title T] [--status S] [--priority P]
berth task log <ref> "<text>"               # 追加一行 `- YYYY-MM-DD: <text>` 到「进展日志」（不覆盖；超阈值自动归档）
berth task doc <ref> [--print]              # 打印上下文文档路径 + 协议(AGENTS.md)路径（--print 附正文）；用自带 Read/Edit 按协议编辑
berth task rm <ref>
berth task sync [--source ID]               # 推本地改动 + 拉外部变更，冲突在界面解决
berth project [list] [--json]
berth project add <name> [--hue HUE]
berth session list [--task <ref>] [--json]              # 列出会话及其绑定的任务
berth session bind [<sessionId>] <ref> [--project P]    # 把已有会话（运行中/已结束）绑定到任务；省略 sessionId=当前会话
berth session unbind [<sessionId>]                      # 解除会话与任务的绑定
# 通用：--port N / --host H 连接非默认地址的服务；berth task help / berth project help / berth session help
```
