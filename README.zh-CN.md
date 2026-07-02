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

### 推荐安装 Agent 集成

npm 包用户可运行：

```bash
berth skill install
```

DMG 用户可在 **设置 → Agent 集成** 一键安装/更新 CLI shim 和内置 `berth-tasks` skill。

内置 skill 会让 agent 能通过 `berth task` 和 `berth project` 帮你管理任务/项目。

## 环境要求

- macOS 是当前主力支持平台。
- 通过 npm 包安装时需要 Node 20+。
- `PATH` 上至少有一个支持的 Agent CLI：`claude`、`codex` 或 `coco`。

## 基本使用

1. 创建项目，从任务起航

一键启动 agent 执行任务：

- 无需关心会话的上下文管理：agent 自动读取项目上下文、任务上下文，无需人工重复描述。多个 agent 自动维护任务上下文，进展记录可以天然继承了。
- agent 自动流转任务状态：启动后即把会话丢到一边，从任务视角轻松管理进行中的会话状态。

<img width="2006" height="1034" alt="img_v3_02131_ec1b983d-8593-4a3d-823b-ee587c3ba48g" src="https://github.com/user-attachments/assets/e494037f-8af6-4331-a8a9-6bb0ef34b03d" />

2. 导入已有会话

- 支持本地会话的导入和绑定任务

<img width="2006" height="1034" alt="img_v3_02131_17ec95ea-8cde-48f4-85c6-13ad68dbe85g" src="https://github.com/user-attachments/assets/ec48de57-74f8-4a00-8d55-7ba0672c9de6" />

## 许可证

ISC。
