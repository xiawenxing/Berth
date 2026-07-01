import { useEffect, useState, type SetStateAction } from 'react'

const PREFIX = 'berth:draft:'

export function draftKey(scope: string): string {
  return `${PREFIX}${scope}`
}

export function readDraft(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

export function writeDraft(key: string, value: string): void {
  try {
    if (value) sessionStorage.setItem(key, value)
    else sessionStorage.removeItem(key)
  } catch {
    // Drafts are a best-effort guardrail; ignore private-mode/quota failures.
  }
}

export function clearDraft(key: string): void {
  try {
    sessionStorage.removeItem(key)
  } catch {
    // best effort
  }
}

export function usePersistentDraft(key: string, initial = '') {
  const [value, setValueState] = useState(() => readDraft(key) || initial)

  useEffect(() => {
    setValueState(readDraft(key) || initial)
  }, [key, initial])

  const setValue = (next: SetStateAction<string>) => {
    setValueState((prev) => {
      const resolved = typeof next === 'function' ? (next as (prev: string) => string)(prev) : next
      writeDraft(key, resolved)
      return resolved
    })
  }

  const clear = () => {
    setValueState('')
    clearDraft(key)
  }

  return { value, setValue, clear }
}
