import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'

/**
 * In-place text editing — the one true rename/add affordance across Berth.
 *
 * Electron's renderer has no working `window.prompt()` (it returns null), so every
 * "rename" / "add" must edit in the DOM. This hook is the shared implementation:
 * call `start()` (from a double-click or a ⋯-menu item), spread `inputProps` onto an
 * `<input>`, and render that input while `editing` is true. Commit on Enter / blur,
 * cancel on Escape — with a skip-blur guard so Enter/Escape don't double-fire commit.
 *
 * `onCommit` only fires when the trimmed value actually changed (and is non-empty,
 * unless `allowEmpty`). Used by TaskCard (task rename), ProjectWorkspace (project
 * rename) and Settings (add a vocab chip).
 */
export function useInlineEdit(
  value: string,
  onCommit: (next: string) => void,
  opts?: { allowEmpty?: boolean },
) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)
  const skipBlur = useRef(false)

  // Autofocus + select on entering edit mode.
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  // Keep the draft in sync when the source value changes underneath us (e.g. a reload)
  // — but never clobber what the user is currently typing.
  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  const start = () => {
    setDraft(value)
    setEditing(true)
  }

  const finish = (commit: boolean) => {
    if (commit) {
      const next = draft.trim()
      if ((opts?.allowEmpty || next) && next !== value) onCommit(next)
    }
    setDraft(value)
    setEditing(false)
  }

  const inputProps = {
    ref: inputRef,
    value: draft,
    onChange: (e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
    onBlur: () => {
      if (!skipBlur.current) finish(true)
      skipBlur.current = false
    },
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        skipBlur.current = true
        finish(true)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        skipBlur.current = true
        finish(false)
      }
    },
  }

  return { editing, start, inputProps }
}
