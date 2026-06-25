import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Search, FolderInput, ChevronDown, ChevronRight, Pin, FolderInput as FolderInputIcon, RefreshCw, Sparkles, Loader2, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CliBadge } from '@/components/workspace/TaskCard'
import { SessionPanel } from '@/components/SessionPanel'
import { SessionTitleBar } from '@/components/SessionTitleBar'
import { useData } from '@/lib/data'
import { relTime, shortCwd } from '@/lib/format'
import { useLive } from '@/lib/live'
import { api } from '@/lib/api'
import { ImportDialog } from '@/components/ImportDialog'
import { ImportChooser, type ImportChoice } from '@/components/ImportChooser'
import { CliImportDialog } from '@/components/CliImportDialog'
import { ImportByIdDialog } from '@/components/ImportByIdDialog'
import { SESSION_SHOW_MORE_PAGE } from '@/lib/paging'
import { type ShipStatus } from '@/lib/types'
import type { ApiSession, ApiProject, PreviewSession } from '@/lib/api'

function Glyph({ status }: { status: ShipStatus }) {
  if (status === 'sail') return <Loader2 size={11} className="flex-none animate-spin text-brand" aria-label="在航" />
  if (status === 'dock') return <span className="h-1.5 w-1.5 flex-none rounded-full bg-destructive" title="有未读" />
  return <span className="h-1.5 w-1.5 flex-none" />
}

function match(s: ApiSession, q: string) {
  if (!q) return true
  const t = q.toLowerCase()
  return (
    (s.title || '').toLowerCase().includes(t) ||
    (s.cwd || '').toLowerCase().includes(t) ||
    s.cli.toLowerCase().includes(t)
  )
}

export function Unassigned() {
  const { sessions, projects, reload, resync } = useData()
  const live = useLive()
  const [selId, setSelId] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [syncing, setSyncing] = useState(false)
  const doResync = () => {
    if (syncing) return
    setSyncing(true)
    resync().finally(() => setSyncing(false))
  }
  // 导入目录: open a chooser (导入 CLI 会话 / 选路径 / 按 ID) before any picker. Each route lands in
  // its own dialog; all imports are project-less → surface under 无归属.
  const [chooserOpen, setChooserOpen] = useState(false)
  const [importDlg, setImportDlg] = useState<{ path: string; sessions: PreviewSession[] } | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [cliDlg, setCliDlg] = useState<{ cli: 'claude' | 'codex' | 'coco'; sessions: PreviewSession[] } | null>(null)
  const [idDlgOpen, setIdDlgOpen] = useState(false)
  // 选择导入路径: native folder pick → preview-by-cwd → ImportDialog (the original flow).
  const onPickPath = async () => {
    if (picking) return
    setPicking(true)
    try {
      const picked = await api.pickFolder()
      if (!picked?.path) return
      const { sessions } = await api.previewDir(picked.path)
      setImportDlg({ path: picked.path, sessions })
    } catch {
      // folder pick / preview failures are non-fatal
    } finally {
      setPicking(false)
    }
  }
  const onPickChoice = async (c: ImportChoice) => {
    setChooserOpen(false)
    if (c.type === 'path') return onPickPath()
    if (c.type === 'id') return setIdDlgOpen(true)
    // c.type === 'cli': scan that CLI's whole store, then open the grouped-by-cwd dialog.
    if (picking) return
    setPicking(true)
    try {
      const { sessions } = await api.previewByCli(c.cli)
      setCliDlg({ cli: c.cli, sessions })
    } catch {
      // scan failure is non-fatal — just don't open the dialog
    } finally {
      setPicking(false)
    }
  }
  const [pinOverrides, setPinOverrides] = useState<Map<string, boolean>>(new Map())
  const [hiddenOverrides, setHiddenOverrides] = useState<Set<string>>(new Set())
  const activeProjects = useMemo(() => projects.filter((p) => !p.archived), [projects])
  const isPinned = (s: ApiSession) => pinOverrides.get(s.sessionId) ?? !!s.pinned

  useEffect(() => {
    setPinOverrides((cur) => {
      if (cur.size === 0) return cur
      let changed = false
      const next = new Map(cur)
      for (const s of sessions) {
        const override = next.get(s.sessionId)
        if (override !== undefined && override === !!s.pinned) {
          next.delete(s.sessionId)
          changed = true
        }
      }
      return changed ? next : cur
    })
  }, [sessions])

  const togglePin = (id: string, nextOn: boolean) => {
    setPinOverrides((prev) => new Map(prev).set(id, nextOn))
    api
      .pin(id, nextOn)
      .then(() => reload())
      .catch(() => {
        setPinOverrides((prev) => {
          const next = new Map(prev)
          next.delete(id)
          return next
        })
        reload()
      })
  }
  const attach = (sessionId: string, projectId: string) => {
    api
      .attach(sessionId, projectId)
      .then(() => reload())
      .catch(() => reload())
  }
  const unimport = (sessionId: string) => {
    setHiddenOverrides((prev) => new Set(prev).add(sessionId))
    if (selId === sessionId) setSelId(null)
    api
      .unimportSessions([sessionId])
      .then(() => {
        reload()
      })
      .catch(() => {
        setHiddenOverrides((prev) => {
          const next = new Set(prev)
          next.delete(sessionId)
          return next
        })
        reload()
      })
  }

  // Unassigned = sessions with no projectId. Pinned sessions get a dedicated section above cwd groups.
  const visibleSessions = useMemo(() => sessions.filter((s) => !hiddenOverrides.has(s.sessionId)), [sessions, hiddenOverrides])
  const pinSessions = useMemo(
    () => visibleSessions.filter((s) => !s.projectId && isPinned(s)).sort((a, b) => b.updatedAt - a.updatedAt),
    [visibleSessions, pinOverrides],
  )
  const groups = useMemo(() => {
    const m = new Map<string, ApiSession[]>()
    for (const s of visibleSessions) {
      if (s.projectId) continue
      if (isPinned(s)) continue
      const key = s.cwd || ''
      const arr = m.get(key)
      if (arr) arr.push(s)
      else m.set(key, [s])
    }
    return [...m.entries()].map(([cwd, list]) => ({
      cwd,
      sessions: list.slice().sort((a, b) => b.updatedAt - a.updatedAt),
    }))
  }, [visibleSessions, pinOverrides])

  const allUnassigned = useMemo(() => [...pinSessions, ...groups.flatMap((g) => g.sessions)], [pinSessions, groups])
  // First real unassigned session selected by default; fall back if selection vanished.
  const sel =
    allUnassigned.find((s) => s.sessionId === selId) ?? allUnassigned[0] ?? null

  const select = (s: ApiSession) => {
    setSelId(s.sessionId)
    live.markSeen(s.sessionId)
  }

  return (
    <div className="flex h-full">
      {/* left persistent list */}
      <div className="flex w-[332px] flex-none flex-col border-r border-border">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <div className="flex flex-1 items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1">
            <Search size={13} className="text-text-dim" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索标题 / cwd / CLI"
              className="flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-text-dim"
            />
          </div>
          <button
            onClick={doResync}
            disabled={syncing}
            className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-50"
            title="同步会话（重新扫描磁盘）"
          >
            <RefreshCw size={14} className={cn(syncing && 'animate-spin')} />
          </button>
          <button
            onClick={() => setChooserOpen(true)}
            disabled={picking}
            className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-50"
            title="导入目录"
          >
            <FolderInput size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {allUnassigned.length === 0 ? (
            <p className="px-3 py-4 text-[12px] text-muted-foreground">没有无归属会话</p>
          ) : (
            <>
              {pinSessions.length > 0 && (
                <SessionGroup
                  key="__pin__"
                  label="Pin"
                  icon={<Pin size={12} className="text-priority" />}
                  sessions={pinSessions.filter((s) => match(s, q))}
                  selId={sel?.sessionId}
                  onSelect={select}
                  isPinned={isPinned}
                  onTogglePin={togglePin}
                  projects={activeProjects}
                  onAttach={attach}
                  onUnimport={unimport}
                  showCwd
                />
              )}
              {groups.map((g) => (
                <SessionGroup
                  key={g.cwd || '__no_cwd__'}
                  label={shortCwd(g.cwd) || '(无 cwd)'}
                  labelMono
                  sessions={g.sessions.filter((s) => match(s, q))}
                  selId={sel?.sessionId}
                  onSelect={select}
                  isPinned={isPinned}
                  onTogglePin={togglePin}
                  projects={activeProjects}
                  onAttach={attach}
                  onUnimport={unimport}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* right session content */}
      <div className="flex min-w-0 flex-1 flex-col bg-canvas">
        {sel ? (
          <>
            <SessionTitleBar
              cli={sel.cli}
              title={sel.title || sel.sessionId}
              cwd={shortCwd(sel.cwd)}
              status={live.shipStatus(sel.sessionId, sel.updatedAt)}
              editable
              generating={!!sel.titleGenerating}
              onRename={async (title) => {
                await api.renameSessionTitle(sel.sessionId, title)
                reload()
              }}
              onGenerate={async () => {
                // Detached: kick + reload; the new title arrives via the sessions poll.
                await api.sessionTitle(sel.sessionId)
                reload()
              }}
            />
            {/* flex flex-col so SessionPanel's flex-1 root fills the height (it's the only inline mount;
                the drawer's wrapper is already flex-col). Without it the panel collapses to xterm's
                24-row default → the terminal renders half-height. */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <SessionPanel key={sel.sessionId} cli={sel.cli} sessionId={sel.sessionId} />
            </div>
          </>
        ) : null}
      </div>

      {chooserOpen && <ImportChooser onPick={onPickChoice} onCancel={() => setChooserOpen(false)} />}

      {importDlg && (
        <ImportDialog
          path={importDlg.path}
          sessions={importDlg.sessions}
          mode="import"
          busy={importBusy}
          onCancel={() => setImportDlg(null)}
          onConfirm={async (ids) => {
            setImportBusy(true)
            try {
              await api.importSessions(ids) // project-less import → surfaces under 无归属
              setHiddenOverrides((prev) => {
                const next = new Set(prev)
                for (const id of ids) next.delete(id)
                return next
              })
              live.markSeenMany(ids)        // imported sessions default to READ, not unread
              setImportDlg(null)
              doResync()
            } finally {
              setImportBusy(false)
            }
          }}
        />
      )}

      {cliDlg && (
        <CliImportDialog
          cli={cliDlg.cli}
          sessions={cliDlg.sessions}
          busy={importBusy}
          onCancel={() => setCliDlg(null)}
          onConfirm={async (ids) => {
            setImportBusy(true)
            try {
              await api.importSessions(ids) // project-less import → surfaces under 无归属
              setHiddenOverrides((prev) => {
                const next = new Set(prev)
                for (const id of ids) next.delete(id)
                return next
              })
              live.markSeenMany(ids)        // imported sessions default to READ, not unread
              setCliDlg(null)
              doResync()
            } finally {
              setImportBusy(false)
            }
          }}
        />
      )}

      {idDlgOpen && (
        <ImportByIdDialog
          busy={importBusy}
          onCancel={() => setIdDlgOpen(false)}
          onImport={async (ids) => {
            setImportBusy(true)
            try {
              await api.importSessions(ids) // project-less import → surfaces under 无归属
              setHiddenOverrides((prev) => {
                const next = new Set(prev)
                for (const id of ids) next.delete(id)
                return next
              })
              live.markSeenMany(ids)        // imported sessions default to READ, not unread
              setIdDlgOpen(false)
              doResync()
            } finally {
              setImportBusy(false)
            }
          }}
        />
      )}
    </div>
  )
}

function SessionGroup({
  label,
  labelMono,
  icon,
  sessions,
  selId,
  onSelect,
  isPinned,
  onTogglePin,
  projects,
  onAttach,
  onUnimport,
  showCwd,
}: {
  label: string
  labelMono?: boolean
  icon?: ReactNode
  sessions: ApiSession[]
  selId?: string
  onSelect: (s: ApiSession) => void
  isPinned: (s: ApiSession) => boolean
  onTogglePin: (id: string, nextOn: boolean) => void
  projects: ApiProject[]
  onAttach: (sessionId: string, projectId: string) => void
  onUnimport: (sessionId: string) => void
  showCwd?: boolean
}) {
  const [collapsed, setCollapsed] = useState(false)
  const LIMIT = 4
  const [shown, setShown] = useState(LIMIT)
  if (sessions.length === 0) return null
  const visible = sessions.slice(0, shown)
  const hidden = sessions.length - visible.length
  return (
    <div>
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        {icon}
        <span className={cn(labelMono && 'font-mono')}>{label}</span>
        <span className="ml-auto">{sessions.length}</span>
      </button>
      {!collapsed && (
        <div>
          {visible.map((s) => (
            <SessionListRow
              key={s.sessionId}
              s={s}
              selected={selId === s.sessionId}
              onSelect={onSelect}
              isPinned={isPinned(s)}
              onTogglePin={onTogglePin}
              projects={projects}
              onAttach={onAttach}
              onUnimport={onUnimport}
              showCwd={showCwd}
            />
          ))}
          {sessions.length > LIMIT && (
            <button
              onClick={() => {
                if (hidden > 0) setShown((v) => Math.min(v + SESSION_SHOW_MORE_PAGE, sessions.length))
                else setShown(LIMIT)
              }}
              className="px-3 py-1 pl-[34px] text-left text-[11px] font-medium text-text-dim hover:text-brand"
            >
              {hidden > 0 ? `展开更多 (${hidden})` : '收起'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** One unassigned-session row: select on click, hover-revealed pin + 归属到项目 actions. */
function SessionListRow({
  s,
  selected,
  onSelect,
  isPinned,
  onTogglePin,
  projects,
  onAttach,
  onUnimport,
  showCwd,
}: {
  s: ApiSession
  selected: boolean
  onSelect: (s: ApiSession) => void
  isPinned: boolean
  onTogglePin: (id: string, nextOn: boolean) => void
  projects: ApiProject[]
  onAttach: (sessionId: string, projectId: string) => void
  onUnimport: (sessionId: string) => void
  showCwd?: boolean
}) {
  const live = useLive()
  const { reload } = useData()
  const [menuOpen, setMenuOpen] = useState(false)
  const [kicked, setKicked] = useState(false) // instant feedback until titleGenerating takes over
  const [failed, setFailed] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const generating = kicked || !!s.titleGenerating
  useEffect(() => { if (s.titleGenerating) setKicked(false) }, [s.titleGenerating])

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const generateTitle = async () => {
    if (generating) return
    setFailed(false)
    setKicked(true)
    try {
      // Detached: kick + reload so titleGenerating shows; the title streams in via the sessions poll.
      await api.sessionTitle(s.sessionId)
      reload()
      window.setTimeout(() => setKicked(false), 8000)
    } catch {
      // 404/422 (e.g. empty session) — flash red so a non-update isn't silent.
      setKicked(false)
      setFailed(true)
      window.setTimeout(() => setFailed(false), 2500)
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(s)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(s)
        }
      }}
      className={cn(
        'group relative flex h-[46px] w-full cursor-pointer items-center gap-2 px-3 text-left hover:bg-sidebar-accent',
        selected &&
          'bg-sidebar-accent before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r before:bg-brand',
      )}
    >
      <Glyph status={live.shipStatus(s.sessionId, s.updatedAt)} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-foreground" title={s.title || s.sessionId}>{s.title || s.sessionId}</div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <CliBadge cli={s.cli} />
          {showCwd && <span className="truncate text-[11px] text-text-dim">{shortCwd(s.cwd)}</span>}
        </div>
      </div>

      {/* hover-revealed actions: pin toggle + 归属到项目 ▾ */}
      <div
        ref={ref}
        className="relative flex flex-none items-center gap-0.5"
        onClick={(e) => e.stopPropagation()}
      >
        <span
          role="button"
          tabIndex={-1}
          title={isPinned ? '取消置顶' : '置顶'}
          onClick={() => onTogglePin(s.sessionId, !isPinned)}
          className={cn(
            'flex-none rounded p-1 hover:bg-secondary',
            isPinned
              ? 'text-priority'
              : 'text-text-dim opacity-0 hover:text-foreground group-hover:opacity-100',
          )}
        >
          <Pin size={13} />
        </span>
        <button
          type="button"
          title={generating ? '正在智能生成标题…' : failed ? '生成失败，点击重试' : '智能生成标题'}
          aria-label="智能生成标题"
          disabled={generating}
          onClick={generateTitle}
          className={cn(
            'flex-none rounded p-1 text-text-dim transition-opacity hover:bg-secondary hover:text-foreground',
            generating ? 'opacity-100' : failed ? 'text-destructive opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          <Sparkles size={13} className={cn(generating && 'spk-twinkle', failed && 'text-destructive')} />
        </button>
        <button
          title="归属到项目"
          onClick={() => setMenuOpen((v) => !v)}
          className={cn(
            'flex-none rounded p-1 text-text-dim opacity-0 hover:bg-secondary hover:text-foreground group-hover:opacity-100',
            menuOpen && 'opacity-100',
          )}
        >
          <FolderInputIcon size={13} />
        </button>
        <button
          type="button"
          title="取消导入"
          aria-label="取消导入"
          onClick={() => onUnimport(s.sessionId)}
          className="flex-none rounded p-1 text-text-dim opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
        >
          <Trash2 size={13} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full z-20 mt-1 max-h-64 w-52 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg">
            <div className="px-2 pb-0.5 pt-1 text-[10px] font-bold uppercase tracking-wide text-text-dim">归属到项目</div>
            {projects.length === 0 ? (
              <div className="px-2 py-1.5 text-[12px] text-muted-foreground">没有可用项目</div>
            ) : (
              projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setMenuOpen(false)
                    onAttach(s.sessionId, p.id)
                  }}
                  className="flex w-full items-center gap-2 truncate rounded px-2 py-1 text-left text-[12px] text-foreground hover:bg-accent"
                >
                  {p.name}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <span className="flex-none text-[11px] text-text-dim">{relTime(s.updatedAt)}</span>
    </div>
  )
}
