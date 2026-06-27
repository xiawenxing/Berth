# 任务模式支持粘贴图片 + 模式切换清空输入

**Date:** 2026-06-26
**Scope:** `web/` 起航对话框 (LaunchDialog) + launch-runner

## 背景 / 问题

起航对话框有两个目的地：**自由提问** 与 **任务**。

1. 图片粘贴此前只在「自由提问」模式可用：只有自由提问的 textarea 绑了 `onPasteImages`，
   `PastedImageStrip` 也只在 `dest === 'free'` 渲染；并且 `launch-runner` 在 `dest !== 'free'`
   时显式丢弃 `images`。结果：从任务起航的会话无法带图，首轮 query 里没有图片。
2. 在「自由提问」与「任务」之间切换时，`images` state 与文字输入不会清空，内容会跨模式残留
   （例如自由提问里粘的图切到任务后仍在、且被静默丢弃）。

需求：
- **任务也应允许粘贴图片**，且带图片的任务起航的会话，首轮 query 中应包含图片。
- **模式切换时，images 与输入框文字都应清空**（草稿保留）。

## 关键架构事实

任务上下文（manifest / task context）由服务端经 **环境变量 + system prompt + SessionStart hook**
注入，**从不走 positional/首轮 prompt**（见 `src/server/pty-ws.ts:384`、`src/pty/launch.ts:79-80`）。
因此任务起航的「首轮 query」本质上就是 **任务备注 `taskNote`**，它已经被设为 `launch.prompt`
（`launch-runner.ts:201`）。所以让任务带图，只需停止丢弃 `images`，其余沿用已修复的
image+prompt 两段式 WS 提交路径，与任务上下文互不干扰。

## 设计

### 1. 任务模式允许图片，且图片进入首轮 query

- `LaunchDialog.tsx`：给任务备注 textarea 加 `onPaste={onPasteImages}`；在其下方渲染
  `<PastedImageStrip images={images} onRemove={removeImage}>`（此前仅自由提问有）。
- `launch-runner.ts`：`images: input.dest === 'free' ? input.images : undefined`
  → `images: input.images`（两种目的地都带图）。
- 效果：任务起航时 `launch.prompt` 已是任务备注，`images` 现随之经两段式 WS 路径
  （先发图、待 CLI 确认 image-paste 的下一帧再发 prompt+Enter）送入首轮。任务上下文仍走独立通道。
  空备注 + 图片 → 仅图片的首轮（与自由提问现状一致）。

### 2. 模式切换清空 images + 当前显示文字（草稿保留）

新增 `changeDest(next)` 包裹单选项的切换：

```ts
const changeDest = (next: 'task' | 'free') => {
  if (next === dest) return
  clearImages()
  if (dest === 'free') setFreeText('') else setTaskNote('')  // 仅清当前（切出）模式的显示文字
  setDest(next)
}
```

`setFreeText('')` / `setTaskNote('')` 不触发 draft autosave（autosave 只在 onChange 写入），
所以 per-mode 草稿保留，下次重新打开对话框仍能恢复。两个单选项的 `onClick` 改接 `changeDest`。

## 测试

- `web/src/lib/launch-runner.test.ts`：新增「任务目的地 + 图片」用例 —— 断言图片不进 URL，
  readiness 帧只发 `img`，下一帧发 `{ t: 'i', d: '\x1b[200~<taskNote>\x1b[201~\r' }`。
- （若现有 harness 支持）`LaunchDialog` 用例：任务模式可粘贴图片；切换模式清空 images 与显示文字、
  保留草稿。

## 非目标

- 不改后端。
- 不改任务上下文注入方式。
- 不改自由提问既有行为（除共享的 image+prompt 两段式路径，已在前一提交修复）。
