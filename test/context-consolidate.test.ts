import { describe, it, expect, vi } from 'vitest'
import { consolidateContext, parseConsolidation } from '../src/agent/context-consolidate'

describe('parseConsolidation', () => {
  it('extracts the first JSON object even with surrounding noise/code fences', () => {
    const r = parseConsolidation('blah\n```json\n{"progress":"2026-06-15: did x","status":"on track"}\n```\n')
    expect(r.progress).toBe('2026-06-15: did x')
    expect(r.status).toBe('on track')
  })
  it('collapses newlines in progress and trims length', () => {
    const r = parseConsolidation('{"progress":"line1\\nline2","status":""}')
    expect(r.progress).not.toContain('\n')
  })
  it('returns empty on unparseable output', () => {
    const r = parseConsolidation('no json here')
    expect(r).toEqual({ progress: '', status: '' })
  })
  it('survives trailing prose containing a brace after the JSON', () => {
    const r = parseConsolidation('{"progress":"did x","status":"ok"} note: the } char is fine')
    expect(r.progress).toBe('did x')
    expect(r.status).toBe('ok')
  })
  it('survives leading prose containing a brace before the JSON', () => {
    const r = parseConsolidation('here {is} the answer:\n{"progress":"p","status":"s"}')
    expect(r.progress).toBe('p')
    expect(r.status).toBe('s')
  })
  it('keeps braces that live inside a string value', () => {
    const r = parseConsolidation('{"progress":"used {placeholder} syntax","status":""}')
    expect(r.progress).toBe('used {placeholder} syntax')
  })
})

describe('consolidateContext', () => {
  it('builds a prompt from context+transcript and returns parsed result', async () => {
    const runAgentFn = vi.fn().mockResolvedValue('{"progress":"2026-06-15: shipped","status":"done"}')
    const r = await consolidateContext(
      { kind: 'project', contextDoc: 'CTX', transcript: 'TRANS', locale: 'zh-CN', agent: { cli: 'claude' } },
      runAgentFn,
    )
    expect(runAgentFn).toHaveBeenCalledOnce()
    const promptArg = runAgentFn.mock.calls[0][0]
    expect(promptArg).toContain('CTX'); expect(promptArg).toContain('TRANS')
    expect(r.progress).toBe('2026-06-15: shipped')
    expect(r.status).toBe('done')
  })
  it('returns empty result (no throw) when the agent errors', async () => {
    const runAgentFn = vi.fn().mockRejectedValue(new Error('boom'))
    const r = await consolidateContext({ kind: 'task', contextDoc: 'C', transcript: 'T', locale: 'en', agent: { cli: 'claude' } }, runAgentFn)
    expect(r).toEqual({ progress: '', status: '' })
  })
})
