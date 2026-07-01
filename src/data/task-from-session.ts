import { generateTaskTitle } from '../agent/index'
import { resolveBerthAgent } from './agent-config'
import { createTask, type CreateResult } from './tasks'
import { triggerTaskSummary } from './task-summary'
import type { DocStore } from './docstore'

type Store = ReturnType<typeof import('../db/store').openStore>

/**
 * 根据一段会话对话 digest 一键建任务并关联到该会话：
 *   digest → berth agent 生成标题 → createTask → 关联会话 → 触发摘要(best-effort)。
 * transcript 的读取与抽取由调用方负责，本函数只吃已抽好的 digest，便于单测。
 */
export async function createTaskFromSession(
  store: Store,
  docStore: DocStore,
  sessionId: string,
  digest: string,
  opts: { projectId?: string } = {},
): Promise<CreateResult> {
  const text = digest.trim()
  if (!text) throw new Error('empty session content')

  const title = (await generateTaskTitle(text, resolveBerthAgent(store))).trim()
  if (!title) throw new Error('agent returned empty title')

  // confirm:true — the user explicitly clicked 一键创建任务, so an agent-title that happens to collide
  // with an existing task's title must still create (and link), never silently no-op as `duplicate`.
  const result = await createTask(store, docStore, title, { projectId: opts.projectId, autoTitle: false, confirm: true })
  if (result.status !== 'created') return result   // defensive: e.g. an unlisted projectId needs-confirm

  store.removeEdgesForSession(sessionId)
  store.addEdge(result.record.id, sessionId)
  if (opts.projectId) store.setAttach(sessionId, opts.projectId, 'confirmed')

  // 摘要必须在关联之后触发：digest provider 才能把这个会话折进任务摘要。
  triggerTaskSummary(store, result.record.id)

  return result
}
