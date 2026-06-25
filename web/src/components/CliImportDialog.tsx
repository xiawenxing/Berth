import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Dialog } from '@/components/ui/Overlay'
import { SessionPickRow } from '@/components/SessionPickRow'
import type { PreviewSession } from '@/lib/api'

const CLI_LABEL: Record<string, string> = { claude: 'Claude', codex: 'Codex', coco: 'Coco' }
const NO_CWD = '(无工作目录)'

/**
 * Import-from-a-CLI dialog: every session of one CLI (across all cwds), grouped by cwd with
 * collapsible group headers (cwd + count + group select-all), a search box (title/cwd), and a global
 * select-all. Pure UI — hands the selected session ids back to the caller, which runs importSessions.
 */
export function CliImportDialog({
  cli,
  sessions,
  busy,
  onCancel,
  onConfirm,
}: {
  cli: 'claude' | 'codex' | 'coco'
  sessions: PreviewSession[]
  busy: boolean
  onCancel: () => void
  onConfirm: (ids: string[]) => void
}) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set())
  const [q, setQ] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  // Filter by title/cwd, then group by cwd (most-recent group first; sessions arrive recent-first).
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const filtered = needle
      ? sessions.filter((s) => (s.title || '').toLowerCase().includes(needle) || (s.cwd || '').toLowerCase().includes(needle))
      : sessions
    const m = new Map<string, PreviewSession[]>()
    for (const s of filtered) {
      const key = s.cwd || NO_CWD
      const arr = m.get(key)
      if (arr) arr.push(s)
      else m.set(key, [s])
    }
    return [...m.entries()].map(([cwd, list]) => ({ cwd, sessions: list }))
  }, [sessions, q])

  const filteredIds = useMemo(() => groups.flatMap((g) => g.sessions.map((s) => s.sessionId)), [groups])
  const allOn = filteredIds.length > 0 && filteredIds.every((id) => checked.has(id))

  const toggleOne = (id: string) =>
    setChecked((s) => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  const setMany = (ids: string[], on: boolean) =>
    setChecked((s) => {
      const next = new Set(s)
      for (const id of ids) (on ? next.add(id) : next.delete(id))
      return next
    })
  const toggleAll = () => setMany(filteredIds, !allOn)
  const toggleCollapse = (cwd: string) =>
    setCollapsed((s) => {
      const next = new Set(s)
      next.has(cwd) ? next.delete(cwd) : next.add(cwd)
      return next
    })

  const n = checked.size
  const total = sessions.length

  return (
    <Dialog open onClose={busy ? () => {} : onCancel} width={560}>
      <div className="flex flex-col">
        <div className="border-b border-border px-4 py-3">
          <div className="text-[13px] font-semibold text-foreground">导入 {CLI_LABEL[cli] ?? cli} 会话</div>
          <div className="mt-0.5 text-[11px] text-text-dim">
            本地共 {total} 个会话 · 按工作目录分组 · 已选 <b className="text-brand">{n}</b>
          </div>
        </div>

        {total === 0 ? (
          <div className="px-4 py-6 text-[12px] text-muted-foreground">没有可导入的 {CLI_LABEL[cli] ?? cli} 会话。</div>
        ) : (
          <>
            <div className="flex items-center gap-2 px-4 pt-2.5">
              <div className="flex flex-1 items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1">
                <Search size={12} className="text-text-dim" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="搜索标题 / 目录"
                  className="flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-text-dim"
                />
              </div>
              <button className="flex-none text-[11px] text-brand hover:underline" onClick={toggleAll} disabled={filteredIds.length === 0}>
                {allOn ? '全不选' : '全选'}
              </button>
            </div>

            <div className="max-h-[50vh] overflow-y-auto px-4 py-2">
              {groups.length === 0 ? (
                <div className="px-1 py-3 text-[12px] text-muted-foreground">没有匹配的会话。</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {groups.map((g) => {
                    const ids = g.sessions.map((s) => s.sessionId)
                    const groupOn = ids.every((id) => checked.has(id))
                    const isCollapsed = collapsed.has(g.cwd)
                    return (
                      <div key={g.cwd} className="rounded-md border border-border/70">
                        <div className="flex items-center gap-1.5 px-2 py-1.5">
                          <button onClick={() => toggleCollapse(g.cwd)} className="flex min-w-0 flex-1 items-center gap-1 text-left">
                            {isCollapsed ? <ChevronRight size={13} className="flex-none text-text-dim" /> : <ChevronDown size={13} className="flex-none text-text-dim" />}
                            <span className="truncate font-mono text-[11px] text-muted-foreground" title={g.cwd}>{g.cwd}</span>
                            <span className="flex-none text-[10.5px] text-text-dim">· {g.sessions.length}</span>
                          </button>
                          <button
                            className={cn('flex-none rounded px-1.5 py-0.5 text-[10.5px]', groupOn ? 'text-brand hover:underline' : 'text-text-dim hover:text-brand')}
                            onClick={() => setMany(ids, !groupOn)}
                          >
                            {groupOn ? '全不选' : '全选本组'}
                          </button>
                        </div>
                        {!isCollapsed && (
                          <div className="flex flex-col gap-1 border-t border-border/60 px-2 py-1.5">
                            {g.sessions.map((s) => (
                              <SessionPickRow key={s.sessionId} session={s} checked={checked.has(s.sessionId)} onToggle={() => toggleOne(s.sessionId)} />
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}

        <div className="flex items-center gap-2 border-t border-border px-4 py-3">
          <span className="flex-1" />
          <button className="rounded-md px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-50" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button
            className="rounded-md bg-brand px-3 py-1.5 text-[12px] font-medium text-brand-foreground hover:bg-brand/90 disabled:opacity-50"
            onClick={() => onConfirm([...checked])}
            disabled={busy || n === 0}
          >
            {busy ? '导入中…' : `导入选中 (${n})`}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
