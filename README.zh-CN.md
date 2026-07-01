<div align="center">

# Berth

### 面向 AI 的任务驾驶舱。

**以项目和任务为中心，组织每一个 Agent 会话，并驱动它们把事情做完。**

[![npm](https://img.shields.io/npm/v/@corusco/berth?color=2563eb&label=npm)](https://www.npmjs.com/package/@corusco/berth)
[![node](https://img.shields.io/badge/node-%E2%89%A520-43853d)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-ISC-blue)](#许可证)
[![platform](https://img.shields.io/badge/platform-macOS-lightgrey)]()

[English](README.md) · [简体中文](README.zh-CN.md)

</div>

---

## Berth 是什么？

Berth 是一个本地 AI Agent 工作驾驶舱。它把这些东西放到同一个工作区里：

- **项目和任务**：本地任务看板、项目工作区、优先级、状态、Markdown 上下文文档。
- **Agent 会话**：统一管理 Claude Code、Codex、Coco 会话，并在内嵌终端里实时恢复。
- **从任务启动**：从任务直接启动 Agent，把项目/任务上下文注入进去，并让产出持续挂在任务下。

Berth 本地优先。它只读各 CLI 自己的会话存储，自己的数据放在 `~/.berth`，核心能力不依赖云账号或外部系统。

## 安装

二选一。

### 方式一：npm 包

```bash
npm install -g @corusco/berth && berth skill install && berth start
```

这会安装 Berth CLI，把内置的 `berth-tasks` skill 安装到本机 agent，然后启动应用并打开 UI。

启动后常用命令：

```bash
berth task list
berth task add "完善 onboarding"
berth project list
```

### 方式二：macOS 桌面应用

从 [GitHub Releases](https://github.com/xiawenxing/Berth/releases/latest) 下载最新 DMG，
打开后把 **Berth** 拖进 Applications。

如果你希望会话里的 agent 能直接使用 `berth task` / `berth project`，打开 Berth 后到
**设置 → Agent 集成** 安装 CLI shim 和内置 `berth-tasks` skill。

#### 首次打开（只需一次）

Berth 的 macOS 安装包做了 ad-hoc 签名，但**没有**走 Apple 付费开发者计划的公证（notarize），
所以首次打开时 Gatekeeper 会弹警告。应用本身没被改动，只需信任一次：

1. 打开 **Applications（应用程序）**，**右键（按住 Control 点击）Berth → 打开**。
2. 在弹出的对话框里点 **打开**。

完成——这一次信任之后，以后每次双击都能正常打开。

> 首次打开**不要直接双击**。双击一个未信任的下载文件，会弹出没有"打开"按钮的死胡同提示
>（"*Apple cannot check it for malicious software / Contact the developer*"）。请改用 右键 → 打开。

如果 右键 → 打开 也被拦（macOS 15 Sequoia 取消了未公证应用的这个捷径），或者你想彻底免掉警告，
在终端里执行一次下面这条命令去掉"下载隔离"标记，之后就能直接双击：

```bash
xattr -dr com.apple.quarantine /Applications/Berth.app
```

## 环境要求

- macOS 是当前主力支持平台。
- 通过 npm 包安装时需要 Node 20+。
- `PATH` 上至少有一个支持的 Agent CLI：`claude`、`codex` 或 `coco`。

## 基本使用

1. 导入或创建项目。
2. 在项目看板里添加任务。
3. 从任务启动 Claude、Codex 或 Coco。
4. 需要查看或继续工作时，在 Berth 里恢复对应会话。

内置 skill 会让 agent 能通过 `berth task` 和 `berth project` 帮你管理任务/项目。

## 可选集成

Berth 可以通过可选数据源适配器同步外部系统里的任务。这些集成默认关闭，只在本地设置里配置后启用；核心应用不依赖它们。

## 开发

贡献者环境、本地调试、测试、打包说明都在 [DEVELOPMENT.md](DEVELOPMENT.md)。

## 许可证

ISC。
