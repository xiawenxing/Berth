# Session Rendering Transport Decision

Date: 2026-06-18

## Decision

Berth 2.0 will prioritize the native CLI PTY path for the current foundation work.

The rich/chat renderer is deferred until the 2.0 baseline is stable. It must not be implemented by
presenting transcript snapshots as if they were a live conversation. Transcript parsing remains valid
only for history, recovery, and final-state reconciliation.

## Why

The required product property is preserving each agent's native capabilities:

- Claude/Codex/Coco interactive loops.
- Built-in commands and slash-command behavior.
- Skills, plugins, MCP configuration, and loaded project/user context.
- Human-in-the-loop permission prompts and tool approvals.
- Long-running session behavior.

PTY is the only transport currently proven in Berth to preserve that full native surface across all
three CLIs. The immediate 2.0 work should therefore make PTY viewing reliable and ergonomic rather
than trade capability for a prettier transcript projection.

## Renderer Contract

The backend transport decides the frontend renderer. Renderers must not guess a protocol.

```text
terminal.v1
  PTY byte stream -> xterm renderer
  Current default for full native capability.

agent-events.v1
  Structured message/tool/permission/status events -> rich renderer
  Future path only after a CLI-specific driver proves native capability parity.

transcript-snapshot.v1
  Parsed session files -> read-only history/recovery/final reconciliation
  Never the primary live UI.

session-status.v1
  Background state events -> lists, badges, red dots, completion/error state
  Separate from the current session content stream.
```

## Rich View Research Notes

Claude is the strongest future candidate for rich rendering. The official VS Code extension appears
to use a native webview backed by structured Claude Agent SDK messages, with terminal mode as a
fallback. Its published package includes a webview bundle and bundled Claude binary; observed symbols
include SDK options such as `includePartialMessages`, `canUseTool`, `onElicitation`, and message
shapes such as `stream_event`, `tool_use`, `tool_result`, and permission requests.

Claude Agent SDK documentation says it provides the same agent loop, tools, and context management as
Claude Code, can load Claude Code filesystem features such as settings, CLAUDE.md, skills, hooks, and
MCP, and supports continuous conversations through the SDK client. This is the right direction for a
future Claude rich driver, but it still needs a Berth spike covering permissions, plan review, diff
review, interruption, login/auth UX, and session identity.

Codex should not be reduced to `codex exec --json` for rich mode. That path is useful automation, but
it is a non-interactive turn worker. The better future candidate is `codex app-server`, which exposes
a JSON-RPC protocol with thread/turn/item/status/permission concepts. It is experimental and needs a
separate spike.

Coco should not use `coco -p --output-format stream-json` as a full replacement for TUI mode. Its own
docs state that non-interactive mode cannot show approval dialogs or ask the user questions. The
future candidate is `coco acp serve`, which is the IDE/ACP protocol path and may preserve more native
interaction semantics.

## Current Work Implications

- Keep full native sessions on `terminal.v1`.
- Fix xterm/PTY reliability issues first: replay correctness, resize behavior, alt-screen handling,
  session switching, and view lifecycle.
- Remove or demote any 2.0 UI behavior that implies transcript snapshots are a live rich session.
- Keep transcript parsing as a secondary projection only.
- Revisit rich mode after baseline 2.0 session/task/project functionality is complete.
