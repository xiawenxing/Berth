import { useEffect, useState, type CSSProperties } from 'react'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useData } from '@/lib/data'
import { resolveColumn, statusMeta } from '@/lib/status'
import { type LinkedSession, type Priority, type Task, type TaskStatus } from '@/lib/types'
import { TaskCard } from './TaskCard'

const pickDefaultActive = (statuses: string[]) =>
  statuses.includes('进行中') ? '进行中' : statuses[Math.min(1, statuses.length - 1)] ?? statuses[0] ?? ''

export function Kanban({
  tasks,
  onLaunch,
  onOpenSession,
  onMove,
  onSetPriority,
  onSetDdl,
  onRename,
  onGenerateTitle,
  titleGeneratingIds,
  onDelete,
  onOpenContext,
  onCreateTask,
}: {
  tasks: Task[]
  onLaunch?: (taskId: string) => void
  onOpenSession?: (link: LinkedSession) => void
  onMove?: (taskId: string, status: TaskStatus) => void
  onSetPriority?: (taskId: string, priority: Priority) => void
  onSetDdl?: (taskId: string, ddl: string | null) => void
  onRename?: (taskId: string, title: string) => void
  onGenerateTitle?: (taskId: string) => void
  titleGeneratingIds?: Set<string>
  onDelete?: (taskId: string) => void
  onOpenContext?: (task: Task) => void
  onCreateTask?: () => void
}) {
  const { statuses } = useData()
  const [active, setActive] = useState<string>(() => pickDefaultActive(statuses))
  const [dropOver, setDropOver] = useState<string | null>(null)

  // Keep the active column valid if the configured vocabulary loads/changes.
  useEffect(() => {
    if (!statuses.includes(active)) setActive(pickDefaultActive(statuses))
  }, [statuses, active])

  if (tasks.length === 0) {
    return (
      <button
        type="button"
        onClick={onCreateTask}
        className="flex min-h-[58px] w-full items-center justify-center gap-2 rounded-md border border-dashed border-brand/50 bg-brand/[0.04] text-[13px] font-semibold text-brand transition-colors hover:border-brand hover:bg-brand/[0.08] hover:text-foreground"
      >
        <Plus size={15} /> 创建任务
      </button>
    )
  }

  return (
    <div className="flex w-full items-start gap-3 overflow-x-auto pb-1">
      {statuses.map((status) => {
        const items = tasks.filter((t) => resolveColumn(t.status, statuses) === status)
        const isActive = status === active
        const isDropOver = dropOver === status
        const meta = statusMeta(status)
        return (
          <div
            key={status}
            // Berth 1.0 color-coded each column by its status accent (header title, dot and the
            // active column's top border). `--col-accent` carries that color to the children below.
            style={{
              '--col-accent': meta.accent,
              ...(isActive ? { borderTopWidth: '2px', borderTopColor: meta.accent } : null),
            } as CSSProperties}
            // Click anywhere in an inactive column (header, body, empty area) to activate+widen it.
            onClick={() => !isActive && setActive(status)}
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              if (dropOver !== status) setDropOver(status)
            }}
            onDragLeave={(e) => {
              // only clear when leaving the column itself, not when entering a child
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropOver((s) => (s === status ? null : s))
            }}
            onDrop={(e) => {
              e.preventDefault()
              setDropOver(null)
              const id = e.dataTransfer.getData('text/plain')
              if (id) onMove?.(id, status)
            }}
            className={cn(
              // overflow-hidden clips the header's square top corners to the column's rounded-md.
              'flex min-h-0 min-w-0 max-h-[700px] flex-col overflow-hidden rounded-md border border-border bg-card transition-[flex-grow] duration-300',
              isActive ? 'flex-[2.2]' : 'flex-1',
              isDropOver && 'border-brand ring-2 ring-brand/60',
            )}
          >
            <button
              onClick={() => setActive(status)}
              className="flex shrink-0 items-center gap-1.5 border-b border-border bg-card px-2.5 py-2 text-[12px] font-semibold hover:bg-accent"
            >
              <span className="h-2 w-2 flex-none rounded-full" style={{ background: 'var(--col-accent)' }} />
              <span className="truncate tracking-[0.3px]" style={{ color: 'var(--col-accent)' }}>{status}</span>
              <span className="ml-auto flex-none rounded-full bg-muted px-1.5 text-[11px] font-medium text-text-dim">
                {items.length}
              </span>
            </button>
            <div className="flex min-h-0 max-h-[660px] flex-col gap-2 overflow-y-auto p-2">
              {items.length === 0 ? (
                <div className="py-1.5 text-center text-[11.5px] text-text-dim">—</div>
              ) : (
                items.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    active={isActive}
                    onLaunch={onLaunch}
                    onOpenSession={onOpenSession}
                    onActivate={() => setActive(status)}
                    onSetStatus={onMove}
                    onSetPriority={onSetPriority}
                    onSetDdl={onSetDdl}
                    onRename={onRename}
                    onGenerateTitle={onGenerateTitle}
                    titleGenerating={titleGeneratingIds?.has(t.id)}
                    onDelete={onDelete}
                    onOpenContext={onOpenContext}
                  />
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
