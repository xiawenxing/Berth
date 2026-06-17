import { useState, type ReactNode } from 'react'
import { FileText, Folder, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api, type PreviewSession, type ApiPathMeta } from '@/lib/api'
import { shortCwd } from '@/lib/data'
import { ImportDialog } from '@/components/ImportDialog'

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
  onOpenDoc,
  onDone,
}: {
  projectId?: string
  projectName?: string
  paths: ApiPathMeta[]
  onOpenDoc?: (target: { kind: 'project' | 'task'; key: string; path: string; title: string }) => void
  onDone?: () => void
}) {
  const [dialog, setDialog] = useState<{ path: string; sessions: PreviewSession[] } | null>(null)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)

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
      setDialog({ path: picked.path, sessions })
    } catch {
      // folder pick / preview failures are non-fatal — the button just no-ops.
    } finally {
      setPicking(false)
    }
  }

  // 添加目录 confirm: ALWAYS register the dir (add-path, enabled), THEN import the picked sessions.
  const onConfirm = async (ids: string[]) => {
    if (!dialog || !projectId) return
    setBusy(true)
    try {
      await api.addPath(projectId, dialog.path, { enabled: true })
      if (ids.length) await api.importSessions(ids, projectId)
      setDialog(null)
      onDone?.()
    } catch {
      // leave the dialog open on error so the user can retry
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-[13px] font-semibold text-foreground">默认装载</h2>
        <span className="ml-auto text-[11px] text-text-dim">开关 = 起航默认装载该目录（cwd 候选）</span>
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

      {/* 代码上下文 (真实 project_path) */}
      <div className="mt-3">
        <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">代码上下文 (cwd / worktree)</div>
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
                  <Toggle on={d.enabled} onChange={() => toggle(d.cwd, !d.enabled)} />
                  <button onClick={() => remove(d.cwd)} title="移除" className="rounded p-1 text-text-dim hover:bg-secondary hover:text-destructive">
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

      {dialog && (
        <ImportDialog
          path={dialog.path}
          sessions={dialog.sessions}
          mode="register"
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={onConfirm}
        />
      )}
    </section>
  )
}
