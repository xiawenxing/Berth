import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, FileText, Folder, FolderInput, Package, Plus, X } from 'lucide-react'
import { api, type PreviewSession, type ApiPathMeta } from '@/lib/api'
import { shortCwd } from '@/lib/format'
import { ImportDialog } from '@/components/ImportDialog'
import { useShowMore } from '@/lib/paging'
import { ShowMoreToggle } from '@/components/ui/ShowMoreToggle'
import { Switch } from '@/components/ui/Switch'

function RegRow({ icon: Icon, name, sub, right }: { icon: typeof Folder; name: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2">
      <Icon size={14} className="flex-none text-muted-foreground" />
      <span className="font-mono text-[12px] text-foreground">{name}</span>
      {sub && <span className="text-[11px] text-text-dim">{sub}</span>}
      <span className="flex-1" />
      {right}
    </div>
  )
}

/**
 * 默认装载 — REAL 货舱 registry (project_path). Each dir has a 默认装载 toggle (起航默认 cwd 候选).
 * 「添加目录」registers the dir (add-path) and optionally imports its existing sessions via the
 * shared ImportDialog. Registering a 货舱 cwd does NOT surface all its sessions — only imported ones.
 */
export function CargoDefaults({
  projectId,
  projectName,
  paths,
  tasks = [],
  onOpenDoc,
  onDone,
  onRemovePath,
  onImported,
}: {
  projectId?: string
  projectName?: string
  paths: ApiPathMeta[]
  // 已登记任务 — each gets a context doc at tasks/<id>/index.md, surfaced as a collapsible list.
  tasks?: { id: string; title: string }[]
  onOpenDoc?: (target: { kind: 'project' | 'task'; key: string; path: string; title: string }) => void
  onDone?: () => void
  // When provided, the parent owns the remove flow (so it can offer 「一并移出会话」, §10.1).
  // Absent → fall back to a direct path removal.
  onRemovePath?: (cwd: string) => void
  // Called with the freshly-imported session ids so the parent can mark them READ (imported
  // sessions default to read, matching the other import entry points). Optional.
  onImported?: (ids: string[]) => void
}) {
  const [dialog, setDialog] = useState<{ path: string; sessions: PreviewSession[]; mode: 'register' | 'import' } | null>(null)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [tasksOpen, setTasksOpen] = useState(false)
  const taskPaging = useShowMore(tasks.length)

  const toggle = (cwd: string, enabled: boolean) => {
    if (!projectId) return
    api.togglePath(projectId, cwd, enabled).then(() => onDone?.()).catch(() => {})
  }
  const remove = (cwd: string) => {
    if (!projectId) return
    api.removePath(projectId, cwd).then(() => onDone?.()).catch(() => {})
  }

  const onAddDir = async () => {
    if (picking) return
    setPicking(true)
    try {
      const picked = await api.pickFolder()
      if (!picked?.path) return
      const { sessions } = await api.previewDir(picked.path)
      setDialog({ path: picked.path, sessions, mode: 'register' })
    } catch {
      // folder pick / preview failures are non-fatal — the button just no-ops.
    } finally {
      setPicking(false)
    }
  }

  // Per-row 导入会话: preview the already-registered dir's on-disk sessions and open the dialog in
  // import-only mode. Preview failures are non-fatal (button no-ops), mirroring onAddDir.
  const onImportRow = async (cwd: string) => {
    try {
      const { sessions } = await api.previewDir(cwd)
      setDialog({ path: cwd, sessions, mode: 'import' })
    } catch {
      // preview failure — no-op
    }
  }

  // Confirm. 'register' (添加目录): register the dir THEN import the picked sessions. 'import'
  // (per-row icon): the dir is already registered — import ONLY, never re-addPath (that would
  // force enabled:true and silently re-enable a directory the user toggled off).
  const onConfirm = async (ids: string[]) => {
    if (!dialog || !projectId) return
    setBusy(true)
    try {
      if (dialog.mode === 'register') {
        await api.addPath(projectId, dialog.path, { enabled: true })
      }
      if (ids.length) {
        await api.importSessions(ids, projectId)
        onImported?.(ids) // imported → READ, consistent with the other import entry points
      }
      setDialog(null)
      onDone?.()
    } catch {
      // leave the dialog open on error so the user can retry
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-4">
      {/* secondary "tool" module — mirrors the 会话 module: dimmed title + neutral tag outside the
          surface, content in an elev-1 card, so the three peer sections share one elevation level. */}
      <div className="mb-3 flex items-center gap-2">
        <Package size={14} className="text-muted-foreground" />
        <h2 className="text-[13px] font-semibold text-muted-foreground">默认装载</h2>
        <span className="rounded-[10px] bg-muted px-2 py-px text-[11px] font-medium tracking-wide text-muted-foreground">货舱</span>
        <span className="flex-1" />
        <span className="text-[11px] text-text-dim">开关 = 起航默认装载该目录（cwd 候选）</span>
      </div>

      <div className="elev-1 rounded-md border border-border bg-card p-4">
      {/* 上下文文档 */}
      <div>
        <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">上下文文档</div>
        <div className="flex flex-col gap-1.5">
          <button
            className="text-left"
            onClick={() =>
              projectName &&
              onOpenDoc?.({ kind: 'project', key: projectName, path: `projects/${projectName}/index.md`, title: `项目上下文 · ${projectName}` })
            }
          >
            <RegRow icon={FileText} name={`项目上下文${projectName ? ` (${projectName})` : ''}`} sub={projectName ? `projects/${projectName}/index.md` : ''} right={<Switch checked onChange={() => {}} />} />
          </button>
          <div className="text-[11px] text-text-dim">点开上方可编辑，或写一句让港务助手整理进上下文</div>

          {/* 任务上下文 — collapsible list, each task → tasks/<id>/index.md */}
          {tasks.length > 0 && (
            <div className="mt-0.5">
              <button
                onClick={() => setTasksOpen((o) => !o)}
                className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                {tasksOpen ? <ChevronDown size={13} className="flex-none" /> : <ChevronRight size={13} className="flex-none" />}
                <span className="font-medium">任务上下文</span>
                <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-text-dim">{tasks.length}</span>
              </button>
              {tasksOpen && (
                <div className="mt-1 flex flex-col gap-1.5 pl-1.5">
                  {tasks.slice(0, taskPaging.visibleCount).map((t) => (
                    <button
                      key={t.id}
                      className="text-left"
                      onClick={() => onOpenDoc?.({ kind: 'task', key: t.id, path: `tasks/${t.id}/index.md`, title: `任务上下文 · ${t.title}` })}
                    >
                      <RegRow icon={FileText} name={t.title} sub={`tasks/${t.id}/index.md`} />
                    </button>
                  ))}
                  {taskPaging.paginated && (
                    <ShowMoreToggle
                      hidden={taskPaging.hidden}
                      total={tasks.length}
                      canCollapse={taskPaging.canCollapse}
                      onMore={taskPaging.loadMore}
                      onCollapse={taskPaging.collapse}
                      className="px-1 py-0.5"
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 代码上下文 (真实 project_path) */}
      <div className="mt-3">
        <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">代码上下文 (cwd / 目录)</div>
        <div className="flex flex-col gap-1.5">
          {paths.length === 0 && (
            <div className="rounded-md border border-dashed border-border px-3 py-2 text-[11px] text-text-dim">
              未登记货舱目录 — 起航将落「项目默认目录」。点下面添加一个。
            </div>
          )}
          {paths.map((d) => (
            <RegRow
              key={d.cwd}
              icon={Folder}
              name={shortCwd(d.cwd)}
              right={
                <span className="flex items-center gap-2">
                  <Switch checked={d.enabled} onChange={() => toggle(d.cwd, !d.enabled)} />
                  <button onClick={() => onImportRow(d.cwd)} title="导入该目录下磁盘上的会话" className="rounded p-1 text-text-dim hover:bg-secondary hover:text-brand">
                    <FolderInput size={13} />
                  </button>
                  <button onClick={() => (onRemovePath ? onRemovePath(d.cwd) : remove(d.cwd))} title="移除" className="rounded p-1 text-text-dim hover:bg-secondary hover:text-destructive">
                    <X size={13} />
                  </button>
                </span>
              }
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
      </div>

      {dialog && (
        <ImportDialog
          path={dialog.path}
          sessions={dialog.sessions}
          mode={dialog.mode}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={onConfirm}
        />
      )}
    </section>
  )
}
