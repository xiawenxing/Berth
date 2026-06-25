import { isDoneStatus } from './status'

export interface DeliveryTaskLike {
  ddl?: string | null
  status: string
}

/** Local YYYY-MM-DD for "today" — matches the backend ddl format. */
export function localTodayISO(now = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${m}-${d}`
}

export function isDeliveryTask(task: DeliveryTaskLike, today = localTodayISO()): boolean {
  if (!task.ddl) return false
  return task.ddl === today || (task.ddl < today && !isDoneStatus(task.status))
}

export function deliveryTasks<T extends DeliveryTaskLike>(tasks: T[], today = localTodayISO()): T[] {
  return tasks
    .filter((task) => isDeliveryTask(task, today))
    .sort((a, b) => (a.ddl ?? '').localeCompare(b.ddl ?? ''))
}

export function deliveryStats<T extends DeliveryTaskLike>(tasks: T[], today = localTodayISO()) {
  const list = deliveryTasks(tasks, today)
  return {
    tasks: list,
    done: list.filter((task) => isDoneStatus(task.status)).length,
    total: list.length,
  }
}
