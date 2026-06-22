// xterm.js answers terminal color queries through onData. In an embedded agent
// TUI those reports are terminal internals, not user keystrokes; forwarding them
// to the PTY can leave `]11;rgb:...` text in Coco's prompt input.
const OSC_COLOR_REPORT = /\x1b\](?:1[0-9]|[4-9]|10|11|12);(?:rgb|rgba):[0-9a-fA-F/]+(?:\x07|\x1b\\)/g

export function stripTerminalGeneratedInput(data: string): string {
  return data.replace(OSC_COLOR_REPORT, '')
}
