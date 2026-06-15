---
name: berth-tasks
version: 1.0.0
description: "Berth 任务/项目管理（Berth 为权威数据，飞书多维表格等只是可选同步源）。用 `berth task` / `berth project` CLI 在本地新增/更新/查询任务、改状态/优先级、记录进展、增删项目、触发同步。⚠️ '处理任务/处理一下/处理这个/完成了'默认按【更新已有任务】解读：先 `berth task list` 按标题反查，命中走更新，未命中再问用户或新增。触发：处理任务、处理待办、处理一下任务、新增任务、添加待办、记录待办、新增todo、加一条任务、更新任务、改状态、标记完成、关闭任务、记录进展、追加进展、查看任务、查待办、看下我的待办、本周任务、未完成任务、按项目分组、新增项目、归档项目、同步任务、berth task、berth project，以及 berth tasks / my tasks / task tracker 等等价英文表述。这是 personal-todo 的 Berth 原生替代。"
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
| 读/改任务上下文文档（长背景/计划/决策） | `berth task doc <ref> --print` 拿路径+正文 → 用 Read/Edit 改对应小节 |
| 改标题/优先级/状态 | `berth task set <ref> [--title T] [--status S] [--priority P]` |
| 删除任务 | `berth task rm <ref>` |
| 查看 / 列出任务 | `berth task list [--status S] [--project P] [--json]` |
| 新增/查看/归档项目 | `berth project list` / `berth project add <name>` |
| 同步到飞书表格等外部源 | `berth task sync` |

`<ref>` 可以是任务 id、id 前缀（≥6 位）或标题子串。标题匹配到多个时 CLI 会列出候选并报错——这时向用户澄清，别瞎选。

## 核心规则

1. **更新优先**：“处理/改/完成/记录进展”默认是对**已有任务**操作。先 `berth task list`（必要时 `--json`）按标题反查；命中唯一→更新；命中多个→让用户挑；没命中→再确认是否新增。
2. **新增任务的项目归属**：`berth task add` 不带 `--project` 时服务端会用 AI 归类；若不确定会返回 needs-confirm 并给候选——把候选转述给用户，用 `--project <名称>` 指定，或 `--confirm` 建为无项目任务，或 `--project <新名> --create-option` 顺带建项目。
3. **状态/优先级取值**有限（在 Berth 设置里配置）。写错值服务端会报 `invalid status/priority`；不确定就先 `berth task list --json` 看现有取值，或让用户在 Berth 设置页确认。
4. **不要直接动数据库或外部表格**。一切经 `berth` CLI（服务端是唯一写入者，并负责同步）。
5. **上下文文档可由 CLI 读写**：`berth task doc <ref>` 披露 `tasks/<id>/index.md` 的路径，agent 用自带 Read/Edit 编辑；进展用 `berth task log` 追加。详见下条。
6. **进展正本在上下文文档**：每个任务有 `tasks/<id>/index.md`，含稳定段（目标/背景，勿擅改）、活跃段（计划/TODO、决策/风险，推进中更新）、追加型「## 进展日志」。
   - 记一条进展：`berth task log <ref> "<一句话>"`（追加，不覆盖；Berth 自动滚动归档）。
   - 改计划/勾选 TODO/记决策：`berth task doc <ref> --print` 看路径与结构，再用 Read/Edit 改对应小节（按文档内 `<!-- 稳定 -->`/`<!-- 活跃 -->`/`<!-- 追加型 -->` 注释行事）。
   - **不要手写短进展摘要（A）**：A 由 Berth 界面的 ✨ 按钮按进展日志生成；skill 只维护进展日志（B）。
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
berth task doc <ref> [--print]              # 打印任务上下文文档绝对路径（--print 附正文）；agent 用自带 Read/Edit 编辑
berth task rm <ref>
berth task sync [--source ID]               # 推本地改动 + 拉外部变更，冲突在界面解决
berth project [list] [--json]
berth project add <name> [--hue HUE]
# 通用：--port N / --host H 连接非默认地址的服务；berth task help / berth project help
```
