import { describe, it, expect, vi } from 'vitest'
vi.mock('../src/agent/index', () => ({ runAgent: vi.fn() }))
import { runAgent } from '../src/agent/index'
import { classifyProject } from '../src/agent/triage'

it('parses ranked candidates from agent JSON', async () => {
  ;(runAgent as any).mockResolvedValue('```json\n{"candidates":[{"name":"Berth","confidence":0.9},{"name":"meego-openapp","confidence":0.2}],"needNewProject":false}\n```')
  const r = await classifyProject('给会话管理器加新建任务能力', ['Berth', 'meego-openapp'])
  expect(r.candidates[0]).toEqual({ name: 'Berth', confidence: 0.9 })
  expect(r.needNewProject).toBe(false)
})

it('drops candidates whose name is not a known project', async () => {
  ;(runAgent as any).mockResolvedValue('{"candidates":[{"name":"Hallucinated","confidence":0.99}],"needNewProject":false}')
  const r = await classifyProject('x', ['Berth'])
  expect(r.candidates).toEqual([])
})

it('falls back to needNewProject on unparseable output', async () => {
  ;(runAgent as any).mockResolvedValue('I think this is about cooking')
  const r = await classifyProject('x', ['Berth'])
  expect(r.candidates).toEqual([])
  expect(r.needNewProject).toBe(true)
})
