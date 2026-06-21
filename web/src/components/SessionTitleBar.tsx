import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
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
  // AI-generate a title from the session transcript. Returns the new title (persisted server-side).
  onGenerate?: () => Promise<string>
}

export function SessionTitleBar({ cli, title, cwd, status, task, editable = false, onRename, onGenerate }: SessionTitleBarProps) {
  const [localTitle, setLocalTitle] = useState(title)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const skipBlurCommit = useRef(false)

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
    if (!onGenerate || generating || saving || editing) return
    setGenerating(true)
    setError(null)
    try {
      const next = (await onGenerate())?.trim()
      if (next) {
        setLocalTitle(next)
        setDraft(next)
      }
    } catch {
      setError('标题生成失败')
    } finally {
      setGenerating(false)
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
          disabled={generating || saving || editing}
          title="智能生成标题"
          aria-label="智能生成标题"
          className={cn(
            'flex-none rounded p-1 text-text-dim transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50',
            generating && 'text-brand',
          )}
        >
          <Sparkles className={cn('h-3.5 w-3.5', generating && 'animate-pulse')} />
        </button>
      )}
      <ShipPill status={status} />
      {task && <span className="flex-none whitespace-nowrap text-[11px] text-muted-foreground">· 航线 {task}</span>}
    </div>
  )
}

function ShipPill({ status }: { status: ShipStatus }) {
  return (
    <span
      className={cn(
        'inline-flex flex-none shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10.5px]',
        status === 'sail' && 'bg-success/15 text-success',
        status === 'dock' && 'bg-brand/15 text-brand',
        status === 'moored' && 'bg-muted text-muted-foreground',
      )}
    >
      {status === 'sail' && <span className="h-1.5 w-1.5 flex-none rounded-full bg-success" />}
      {SHIP_LABEL[status]}
    </span>
  )
}
