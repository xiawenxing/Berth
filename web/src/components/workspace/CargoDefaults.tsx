import { useState, type ReactNode } from 'react'
import { FileText, Folder, GitBranch, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api, type PreviewSession } from '@/lib/api'
import { relTime } from '@/lib/data'
import { CliBadge } from '@/components/workspace/TaskCard'
import { Dialog } from '@/components/ui/Overlay'
import type { CargoDir } from '@/lib/types'

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={cn(
        'flex h-5 w-9 flex-none items-center rounded-full px-0.5 transition-colors',
        on ? 'bg-success/70' : 'bg-muted',
      )}
    >
      <span className={cn('h-4 w-4 rounded-full bg-card-foreground transition-transform', on && 'translate-x-4')} />
    </button>
  )
}

function RegRow({
  icon: Icon,
  name,
  sub,
  right,
}: {
  icon: typeof Folder
  name: string
  sub?: string
  right?: ReactNode
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2">
      <Icon size={14} className="flex-none text-muted-foreground" />
      <span className="text-[13px] text-foreground">{name}</span>
      {sub && <span className="font-mono text-[11px] text-text-dim">{sub}</span>}
      <span className="flex-1" />
      {right}
    </div>
  )
}

/** Pick-then-preview dialog: choose which sessions under a dir to import into this project. */
function ImportDialog({
  path,
  sessions,
  busy,
  onCancel,
  onConfirm,
}: {
  path: string
  sessions: PreviewSession[]
  busy: boolean
  onCancel: () => void
  onConfirm: (ids: string[]) => void
}) {
  // Default: all checked.
  const [checked, setChecked] = useState<Set<string>>(() => new Set(sessions.map((s) => s.sessionId)))
  const allOn = sessions.length > 0 && checked.size === sessions.length
  const toggleOne = (id: string) =>
    setChecked((s) => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  const toggleAll = () => setChecked(allOn ? new Set() : new Set(sessions.map((s) => s.sessionId)))

  return (
    <Dialog open onClose={busy ? () => {} : onCancel} width={520}>
      <div className="flex flex-col">
        <div className="border-b border-border px-4 py-3">
          <div className="text-[13px] font-semibold text-foreground">导入会话</div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-text-dim">{path}</div>
        </div>

        {sessions.length === 0 ? (
          <div className="px-4 py-6 text-[12px] text-muted-foreground">
            该目录下没有会话，仅登记为代码上下文目录
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-4 pt-2.5">
              <span className="text-[11px] text-text-dim">在该目录下找到 {sessions.length} 个会话</span>
              <button className="text-[11px] text-brand hover:underline" onClick={toggleAll}>
                {allOn ? '全不选' : '全选'}
              </button>
            </div>
            <div className="max-h-[44vh] overflow-y-auto px-4 py-2">
              <div className="flex flex-col gap-1">
                {sessions.map((s) => {
                  const on = checked.has(s.sessionId)
                  return (
                    <button
                      key={s.sessionId}
                      onClick={() => toggleOne(s.sessionId)}
                      className={cn(
                        'flex items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors',
                        on ? 'border-brand/50 bg-brand/5' : 'border-border hover:bg-muted/40',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-4 w-4 flex-none items-center justify-center rounded border text-[10px]',
                          on ? 'border-brand bg-brand text-brand-foreground' : 'border-border text-transparent',
                        )}
                      >
                        ✓
                      </span>
                      <CliBadge cli={s.cli} />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                        {s.title || '(未命名)'}
                      </span>
                      <span className="flex-none text-[11px] text-text-dim">{relTime(s.updatedAt)}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            className="rounded-md px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-50"
            onClick={onCancel}
            disabled={busy}
          >
            取消
          </button>
          <button
            className="rounded-md bg-brand px-3 py-1.5 text-[12px] font-medium text-brand-foreground hover:bg-brand/90 disabled:opacity-50"
            onClick={() => onConfirm([...checked])}
            disabled={busy}
          >
            {busy ? '导入中…' : sessions.length === 0 ? '登记目录' : `导入选中 (${checked.size})`}
          </button>
        </div>
      </div>
    </Dialog>
  )
}

export function CargoDefaults({
  dirs,
  projectId,
  projectName,
  onOpenDoc,
  onDone,
}: {
  dirs: CargoDir[]
  projectId?: string
  projectName?: string
  onOpenDoc?: (target: { kind: 'project' | 'task'; key: string; path: string; title: string }) => void
  onDone?: () => void
}) {
  const [state, setState] = useState(dirs)
  const toggle = (i: number) => setState((s) => s.map((d, j) => (j === i ? { ...d, on: !d.on } : d)))

  // Folder-pick → preview → pick-sessions dialog state.
  const [dialog, setDialog] = useState<{ path: string; sessions: PreviewSession[] } | null>(null)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)

  const onAddDir = async () => {
    if (picking) return
    setPicking(true)
    try {
      const picked = await api.pickFolder()
      if (!picked?.path) return
      const { sessions } = await api.previewDir(picked.path)
      setDialog({ path: picked.path, sessions })
    } catch {
      // swallow — folder pick / preview failures are non-fatal; the button just no-ops.
    } finally {
      setPicking(false)
    }
  }

  const onConfirm = async (ids: string[]) => {
    if (!dialog) return
    setBusy(true)
    try {
      // Register the dir as an import root (so the picked sessions become known to the store)…
      await api.importDir(dialog.path)
      // …then pin the selected ones to this project. Unselected ones remain under 无归属.
      if (projectId) {
        for (const id of ids) await api.attach(id, projectId)
      }
      // Reflect the dir locally in the 代码上下文 list.
      setState((s) =>
        s.some((d) => d.path === dialog.path)
          ? s
          : [...s, { path: dialog.path, label: '', kind: 'repo', on: true }],
      )
      setDialog(null)
      onDone?.()
    } catch {
      // Leave the dialog open on error so the user can retry.
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-[13px] font-semibold text-foreground">默认装载</h2>
        <span className="ml-auto text-[11px] text-text-dim">起航自动装载，不必每次选</span>
      </div>

      {/* 上下文文档 */}
      <div className="mt-3">
        <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">上下文文档</div>
        <div className="flex flex-col gap-1.5">
          <button
            className="text-left"
            onClick={() =>
              projectName &&
              onOpenDoc?.({ kind: 'project', key: projectName, path: `projects/${projectName}/index.md`, title: `项目上下文 · ${projectName}` })
            }
          >
            <RegRow icon={FileText} name={`项目上下文${projectName ? ` (${projectName})` : ''}`} sub={projectName ? `projects/${projectName}/index.md` : ''} right={<Toggle on onChange={() => {}} />} />
          </button>
          <div className="text-[11px] text-text-dim">点开上方可编辑，或写一句让港务助手整理进上下文</div>
        </div>
      </div>

      {/* 代码上下文 */}
      <div className="mt-3">
        <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">代码上下文 (cwd / worktree)</div>
        <div className="flex flex-col gap-1.5">
          {state.map((d, i) => (
            <RegRow
              key={d.path}
              icon={d.kind === 'worktree' ? GitBranch : Folder}
              name={d.path}
              sub={d.label}
              right={<Toggle on={d.on} onChange={() => toggle(i)} />}
            />
          ))}
          <button
            className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-2 text-[12px] text-muted-foreground hover:border-brand hover:text-brand disabled:opacity-50"
            onClick={onAddDir}
            disabled={picking}
          >
            <Plus size={13} /> {picking ? '选择目录…' : '添加目录'}
          </button>
        </div>
      </div>

      {dialog && (
        <ImportDialog
          path={dialog.path}
          sessions={dialog.sessions}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={onConfirm}
        />
      )}
    </section>
  )
}
