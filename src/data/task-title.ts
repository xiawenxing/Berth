import { generateTaskTitle } from '../agent/index'
import type { BerthAgent } from '../agent/index'
import type { DocStore } from './docstore'
import { listTasks, updateTask } from './tasks'

type Store = ReturnType<typeof import('../db/store').openStore>

export interface TaskTitleSessionClue {
  id: string
  title: string | null | undefined
}

function readTaskContext(docStore: DocStore, taskId: string, detailDoc: string | null): string {
  const refs = [detailDoc, docStore.taskDocRef(taskId)].filter((x): x is string => !!x)
  for (const ref of refs) {
    const abs = docStore.resolveDocPath(ref)
    if (!abs) continue
    try {
      return docStore.readDoc(abs).content
    } catch {
      // The context doc is lazy-created; a task can legitimately have no file yet.
    }
  }
  return ''
}

export function taskTitleInput(
  task: { id: string; title: string; project?: string | null; progress?: string | null; detailDoc?: string | null },
  docStore: DocStore,
  sessions: TaskTitleSessionClue[],
): string {
  const context = readTaskContext(docStore, task.id, task.detailDoc ?? null).trim()
  const sessionTitles = sessions
    .map((s) => (s.title ?? '').trim())
    .filter(Boolean)
  return [
    `Current title: ${task.title}`,
    task.project ? `Project: ${task.project}` : '',
    task.progress ? `Progress summary: ${task.progress}` : '',
    context ? `Task context:\n${context.slice(0, 3000)}` : '',
    sessionTitles.length ? `Linked session titles:\n${sessionTitles.map((t) => `- ${t}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')
}

export async function generateAndApplyTaskTitle(
  store: Store,
  docStore: DocStore,
  taskId: string,
  sessions: TaskTitleSessionClue[],
  agent?: BerthAgent,
): Promise<{ title: string }> {
  const task = listTasks(store).find((t) => t.id === taskId)
  if (!task) throw new Error('unknown task')
  const input = taskTitleInput(task, docStore, sessions)
  const title = (await generateTaskTitle(input, agent)).trim()
  if (!title) throw new Error('agent returned empty title')
  updateTask(store, task.id, { title })
  return { title }
}
