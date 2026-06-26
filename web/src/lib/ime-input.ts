// IME-safe composition input for xterm.js 5.5.0.
//
// xterm's CompositionHelper derives the committed IME text by *slicing its hidden
// <textarea>*: `value.substring(start, end)` plus `value.replace(before, '')` to track
// `_dataAlreadySent`, spread across two racing `setTimeout(0)` paths (the `compositionend`
// finalize vs. the immediate `keydown` finalize). The textarea is only cleared on
// Enter / Ctrl-C / blur, so a whole CJK line ACCUMULATES in it and gets re-sliced on every
// composition. With rapid consecutive compositions the offsets and `_dataAlreadySent` drift,
// so the slice occasionally returns the wrong range — characters dropped, duplicated, or
// reordered. That's the intermittent "确认输入的字和出现的字不一样" corruption.
//
// Fix: trust the browser's authoritative `CompositionEvent.data` instead of xterm's slice.
// On `compositionend` we send the committed string ourselves, then clear the textarea so:
//   1. xterm's own deferred slice reads '' and emits nothing — no double-send, and
//   2. the next `compositionstart` begins from offset 0, so nothing ever accumulates/drifts.
// Our listener is attached AFTER `term.open()`, so it runs after xterm's `compositionend`
// handler — which only *schedules* its read — making the clear-then-read ordering robust.
export function attachImeComposition(
  textarea: HTMLTextAreaElement,
  sendInput: (data: string) => void,
): () => void {
  const onCompositionEnd = (event: CompositionEvent) => {
    if (event.data) sendInput(event.data)
    textarea.value = ''
  }
  textarea.addEventListener('compositionend', onCompositionEnd)
  return () => textarea.removeEventListener('compositionend', onCompositionEnd)
}
