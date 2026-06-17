import { useState } from 'react'
import { cn } from '@/lib/utils'
import { STATUS_ORDER, type Priority, type Task, type TaskStatus } from '@/lib/types'
import { TaskCard } from './TaskCard'

const COL_DOT: Record<TaskStatus, string> = {
  待办: 'bg-muted-foreground',
  进行中: 'bg-priority',
  待评估: 'bg-purple',
  已完成: 'bg-success',
  已取消: 'bg-muted-foreground',
}

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
  onOpenSession?: (t: string) => void
  onMove?: (taskId: string, status: TaskStatus) => void
  onSetPriority?: (taskId: string, priority: Priority) => void
  onRename?: (taskId: string, title: string) => void
  onDelete?: (taskId: string) => void
}) {
  const [active, setActive] = useState<TaskStatus>('进行中') // default active column
  const [dropOver, setDropOver] = useState<TaskStatus | null>(null)

  return (
    <div className="flex h-[700px] max-h-[700px] w-full items-stretch gap-3">
      {STATUS_ORDER.map((status) => {
        const items = tasks.filter((t) => t.status === status)
        const isActive = status === active
        const isDropOver = dropOver === status
        return (
          <div
            key={status}
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
              'flex min-h-0 min-w-0 flex-col rounded-md border border-border bg-card transition-[flex-grow] duration-300',
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
              <span className={cn('h-1.5 w-1.5 flex-none rounded-full', COL_DOT[status])} />
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
