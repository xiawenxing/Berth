import { useEffect, useState } from 'react'
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
  onRename,
  onDelete,
}: {
  tasks: Task[]
  onLaunch?: (t: string) => void
  onOpenSession?: (link: LinkedSession) => void
  onMove?: (taskId: string, status: TaskStatus) => void
  onSetPriority?: (taskId: string, priority: Priority) => void
  onRename?: (taskId: string, title: string) => void
  onDelete?: (taskId: string) => void
}) {
  const { statuses } = useData()
  const [active, setActive] = useState<string>(() => pickDefaultActive(statuses))
  const [dropOver, setDropOver] = useState<string | null>(null)

  // Keep the active column valid if the configured vocabulary loads/changes.
  useEffect(() => {
    if (!statuses.includes(active)) setActive(pickDefaultActive(statuses))
  }, [statuses, active])

  return (
    <div className="flex h-[700px] max-h-[700px] w-full items-stretch gap-3">
      {statuses.map((status) => {
        const items = tasks.filter((t) => resolveColumn(t.status, statuses) === status)
        const isActive = status === active
        const isDropOver = dropOver === status
        const meta = statusMeta(status)
        return (
          <div
            key={status}
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
              'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card transition-[flex-grow] duration-300',
              isActive ? 'flex-[2.2] border-brand/45' : 'flex-1',
              isDropOver && 'border-brand ring-2 ring-brand/60',
            )}
          >
            <button
              onClick={() => setActive(status)}
              className={cn(
                'sticky top-0 z-10 flex items-center gap-1.5 border-b border-border bg-card px-2.5 py-2 text-[12px] font-semibold text-foreground hover:bg-accent',
                isActive && 'text-accent-foreground',
              )}
            >
              <span className={cn('h-1.5 w-1.5 flex-none rounded-full', meta.dot)} />
              <span className="truncate">{status}</span>
              <span className="ml-auto flex-none rounded-full bg-muted px-1.5 text-[11px] font-medium text-text-dim">
                {items.length}
              </span>
            </button>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
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
                    onRename={onRename}
                    onDelete={onDelete}
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
