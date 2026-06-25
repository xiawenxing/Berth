import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Spinner } from './ui/Spinner'
import { CliBadge } from './workspace/TaskCard'
import { SHIP_LABEL, type ShipStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

interface SessionTitleBarProps {
  cli: string
  title: string
  cwd?: string | null
  status: ShipStatus
  task?: string
  editable?: boolean
  onRename?: (title: string) => Promise<void> | void
  // Kick a detached title (re)generation. The run continues server-side regardless; `generating`
  // (driven by the session's titleGenerating) is the source of truth for the spinner.
  onGenerate?: () => Promise<void> | void
  generating?: boolean
}

export function SessionTitleBar({ cli, title, cwd, status, task, editable = false, onRename, onGenerate, generating = false }: SessionTitleBarProps) {
  const [localTitle, setLocalTitle] = useState(title)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const [saving, setSaving] = useState(false)
  const [kicked, setKicked] = useState(false) // instant local feedback until the server flag takes over
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const skipBlurCommit = useRef(false)
  const busy = kicked || generating
  // Hand off from the optimistic local flag once the server confirms it's generating.
  useEffect(() => { if (generating) setKicked(false) }, [generating])

  useEffect(() => {
    if (!editing) {
      setLocalTitle(title)
      setDraft(title)
    }
  }, [title])

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  const startEditing = () => {
    if (!editable || saving) return
    setDraft(localTitle)
    setError(null)
    setEditing(true)
  }

  const cancelEditing = () => {
    skipBlurCommit.current = true
    setDraft(localTitle)
    setError(null)
    setEditing(false)
    window.setTimeout(() => {
      skipBlurCommit.current = false
    }, 0)
  }

  const generateTitle = async () => {
    if (!onGenerate || busy || saving || editing) return
    setError(null)
    setKicked(true)
    try {
      await onGenerate() // detached: just kicks the run; the new title arrives via prop on the next poll
      window.setTimeout(() => setKicked(false), 8000) // safety: clear if the server flag never shows
    } catch {
      setError('标题生成失败')
      setKicked(false)
    }
  }

  const commitEditing = async () => {
    if (saving) return
    const next = draft.trim()
    if (!next || next === localTitle) {
      setDraft(localTitle)
      setEditing(false)
      setError(null)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onRename?.(next)
      setLocalTitle(next)
      setDraft(next)
      setEditing(false)
    } catch {
      setError('标题保存失败')
      inputRef.current?.focus()
      inputRef.current?.select()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-2 border-b border-border px-4 py-2.5">
      <CliBadge cli={cli} />
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (!skipBlurCommit.current) void commitEditing()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void commitEditing()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                cancelEditing()
              }
            }}
            className={cn(
              'h-6 w-full rounded border border-input bg-background px-1.5 text-[13px] font-semibold text-foreground outline-none focus:border-ring',
              error && 'border-destructive focus:border-destructive',
            )}
          />
        ) : (
          <button
            type="button"
            title={editable ? `${localTitle}（双击修改标题）` : localTitle}
            onDoubleClick={startEditing}
            className={cn(
              'block max-w-full truncate bg-transparent p-0 text-left text-[13px] font-semibold text-foreground',
              editable && 'cursor-text',
            )}
          >
            {localTitle}
          </button>
        )}
        <div className="mt-0.5 truncate font-mono text-[11px] text-text-dim" title={cwd ?? undefined}>
          {error ?? cwd}
        </div>
      </div>
      {onGenerate && (
        <button
          type="button"
          onClick={generateTitle}
          disabled={busy || saving || editing}
          title={busy ? '正在智能生成标题…' : '智能生成标题'}
          aria-label="智能生成标题"
          className="flex-none rounded p-1 text-text-dim transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <Sparkles className={cn('h-3.5 w-3.5', busy && 'spk-twinkle')} />
        </button>
      )}
      <ShipPill status={status} task={task} />
    </div>
  )
}

function ShipPill({ status, task }: { status: ShipStatus; task?: string }) {
  const routeLabel = task ? `航线 ${task}` : undefined
  return (
    <span
      title={routeLabel}
      className={cn(
        'group relative inline-flex flex-none shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10.5px]',
        status === 'sail' && 'bg-brand/15 text-brand',
        status === 'dock' && 'bg-destructive/15 text-destructive',
        status === 'moored' && 'bg-muted text-muted-foreground',
      )}
    >
      {status === 'sail' && <Spinner size={11} />}
      {SHIP_LABEL[status]}
      {routeLabel && (
        <span className="pointer-events-none absolute left-full top-1/2 z-20 ml-2 hidden max-w-[420px] -translate-y-1/2 truncate rounded-md border border-border bg-popover px-2 py-1 text-[11px] font-normal text-popover-foreground shadow-lg group-hover:block">
          {routeLabel}
        </span>
      )}
    </span>
  )
}
