// xterm.js answers terminal control queries through onData. In an embedded agent TUI those
// reports are terminal internals, not user keystrokes; forwarding them to the PTY leaves stray
// escape text in the agent's prompt input. This bites hardest on *resume*: the replayed scrollback
// re-feeds the agent's original startup queries (DA request, focus-tracking enable) back into
// xterm, which dutifully re-answers them — and those answers land in the now-live agent's input as
// garbage like `^[[I^[[?1;2c`. Strip every terminal-generated report before it reaches the PTY.
const OSC_COLOR_REPORT = /\x1b\](?:1[0-9]|[4-9]|10|11|12);(?:rgb|rgba):[0-9a-fA-F/]+(?:\x07|\x1b\\)/g
// Device Attributes responses: DA1 `CSI ? … c` and DA2 `CSI > … c`. Always terminal→program; the
// `?`/`>` private prefix means this can't be a normal CSI keystroke (arrows, Home/End, …).
const DEVICE_ATTRIBUTES_REPORT = /\x1b\[[?>][0-9;]*c/g
// Focus in/out reports: `CSI I` / `CSI O`, emitted only while focus-tracking mode is on. Useful to a
// standalone TUI, but here Berth drives focus itself (refocus on mousedown) so they're pure noise to
// the agent. Note: SS3 function keys are `ESC O x` (no `[`), so this won't eat real keystrokes.
const FOCUS_EVENT_REPORT = /\x1b\[[IO]/g

export function stripTerminalGeneratedInput(data: string): string {
  return data
    .replace(OSC_COLOR_REPORT, '')
    .replace(DEVICE_ATTRIBUTES_REPORT, '')
    .replace(FOCUS_EVENT_REPORT, '')
}
