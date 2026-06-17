import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseTranscriptTurns, resolveTranscriptPath } from '../src/server/transcript-turns'

function tmpFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'berth-turns-'))
  const p = join(dir, name)
  writeFileSync(p, content)
  return p
}

const jl = (...objs: any[]) => objs.map(o => JSON.stringify(o)).join('\n') + '\n'

describe('parseTranscriptTurns - claude', () => {
  it('extracts user text, assistant text, tool_use and tool_result', () => {
    const p = tmpFile('s.jsonl', jl(
      { type: 'user', message: { role: 'user', content: '帮我重构会话列表' } },
      { type: 'assistant', message: { role: 'assistant', content: [
        { type: 'thinking', thinking: 'noise' },
        { type: 'text', text: '好的，我先看代码。' },
        { type: 'tool_use', name: 'Bash', input: { command: 'rg foo' } },
      ] } },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'foo at line 4' }] } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '改完了。' }] } },
    ))
    const turns = parseTranscriptTurns('claude', p)
    // The tool_use + tool_result run is coalesced into a single 'tool' turn ("执行过程").
    expect(turns.map(t => t.role)).toEqual(['user', 'agent', 'tool', 'agent'])
    expect(turns[0].text).toBe('帮我重构会话列表')
    expect(turns[1].text).toBe('好的，我先看代码。')
    expect(turns[2].text).toContain('Bash')
    expect(turns[2].text).toContain('foo at line 4')
    expect(turns[2].collapsed).toBe(true)
    expect(turns[3].text).toBe('改完了。')
  })

  it('drops injected system/hook noise from user turns', () => {
    const p = tmpFile('s.jsonl', jl(
      { type: 'user', message: { role: 'user', content: '<system-reminder>AGENTS.md context</system-reminder>' } },
      { type: 'user', message: { role: 'user', content: '真实问题' } },
    ))
    const turns = parseTranscriptTurns('claude', p)
    expect(turns).toHaveLength(1)
    expect(turns[0]).toEqual({ role: 'user', text: '真实问题' })
  })
})

describe('parseTranscriptTurns - tool coalescing', () => {
  it('merges a run of adjacent tool turns into a single 执行过程 row', () => {
    const p = tmpFile('s.jsonl', jl(
      { type: 'user', message: { role: 'user', content: '改一下' } },
      { type: 'assistant', message: { role: 'assistant', content: [
        { type: 'tool_use', name: 'Bash', input: { command: 'rg a' } },
        { type: 'tool_use', name: 'Read', input: { path: '/x' } },
      ] } },
      { type: 'user', message: { role: 'user', content: [
        { type: 'tool_result', content: 'a at line 1' },
        { type: 'tool_result', content: 'file body' },
      ] } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '完成。' }] } },
    ))
    const turns = parseTranscriptTurns('claude', p)
    expect(turns.map(t => t.role)).toEqual(['user', 'tool', 'agent'])
    // The single coalesced tool turn carries all four tool fragments.
    expect(turns[1].text).toContain('Bash')
    expect(turns[1].text).toContain('Read')
    expect(turns[1].text).toContain('a at line 1')
    expect(turns[1].text).toContain('file body')
    expect(turns[1].collapsed).toBe(true)
  })
})

describe('parseTranscriptTurns - head+tail read', () => {
  it('keeps the opening user prompt even when the middle is past the byte cap', () => {
    // Opening prompt, then a huge block of filler assistant lines, then a recent user turn.
    const opening = { type: 'user', message: { role: 'user', content: 'OPENING_PROMPT_marker' } }
    const filler = Array.from({ length: 4000 }, (_, i) => ({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(200) + ` #${i}` }] },
    }))
    const recent = { type: 'user', message: { role: 'user', content: 'RECENT_PROMPT_marker' } }
    const p = tmpFile('big.jsonl', jl(opening, ...filler, recent))
    const turns = parseTranscriptTurns('claude', p)
    const userTexts = turns.filter(t => t.role === 'user').map(t => t.text)
    // Both the head (opening) and the tail (recent) user prompts survive.
    expect(userTexts).toContain('OPENING_PROMPT_marker')
    expect(userTexts).toContain('RECENT_PROMPT_marker')
  })
})

describe('parseTranscriptTurns - codex', () => {
  it('extracts response_item message + function_call, skips event_msg duplicate', () => {
    const p = tmpFile('rollout.jsonl', jl(
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '打分任务' }] } },
      { type: 'event_msg', payload: { type: 'agent_message', message: '我会先读说明' } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '我会先读说明' }] } },
      { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: { cmd: 'ls' } } },
    ))
    const turns = parseTranscriptTurns('codex', p)
    expect(turns.map(t => t.role)).toEqual(['user', 'agent', 'tool'])
    expect(turns[0].text).toBe('打分任务')
    expect(turns[1].text).toBe('我会先读说明')
    expect(turns[2].text).toContain('exec_command')
  })

  it('drops developer/environment_context messages', () => {
    const p = tmpFile('rollout.jsonl', jl(
      { type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'text', text: 'permissions instructions' }] } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'text', text: '<environment_context><cwd>/x</cwd></environment_context>' }] } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'text', text: '真正的任务' }] } },
    ))
    const turns = parseTranscriptTurns('codex', p)
    expect(turns).toHaveLength(1)
    expect(turns[0].text).toBe('真正的任务')
  })
})

describe('parseTranscriptTurns - coco', () => {
  it('extracts nested message events and tool_call', () => {
    const p = tmpFile('events.jsonl', jl(
      { message: { message: { role: 'user', content: '请开始处理任务：「任务222」。' } } },
      { tool_call: { tool_info: { annotations: { title: 'Read' } }, arguments: { path: '/x' } } },
      { message: { message: { role: 'assistant', content: '已完成本轮处理。', tool_calls: [] } } },
    ))
    const turns = parseTranscriptTurns('coco', p)
    expect(turns.map(t => t.role)).toEqual(['user', 'tool', 'agent'])
    expect(turns[0].text).toBe('请开始处理任务：「任务222」。')
    expect(turns[1].text).toContain('Read')
    expect(turns[2].text).toBe('已完成本轮处理。')
  })

  it('resolves session.json content path to events.jsonl', () => {
    const dir = mkdtempSync(join(tmpdir(), 'berth-coco-'))
    const sdir = join(dir, 'sessions', 'abc')
    mkdirSync(sdir, { recursive: true })
    writeFileSync(join(sdir, 'session.json'), '{"id":"abc"}')
    writeFileSync(join(sdir, 'events.jsonl'), jl({ message: { message: { role: 'user', content: 'hi from events' } } }))
    const resolved = resolveTranscriptPath('coco', join(sdir, 'session.json'))
    expect(resolved).toBe(join(sdir, 'events.jsonl'))
    const turns = parseTranscriptTurns('coco', join(sdir, 'session.json'))
    expect(turns).toEqual([{ role: 'user', text: 'hi from events' }])
  })
})

describe('parseTranscriptTurns - fallback & edge cases', () => {
  it('returns a single cleaned agent turn for an unknown shape', () => {
    const p = tmpFile('weird.jsonl', jl({ some: 'unrecognized', shape: true }, { more: 'lines' }))
    const turns = parseTranscriptTurns('claude', p)
    // No claude-shaped turns → fallback to one agent turn of cleaned raw text.
    expect(turns).toHaveLength(1)
    expect(turns[0].role).toBe('agent')
  })

  it('returns [] for a missing path or null', () => {
    expect(parseTranscriptTurns('claude', null)).toEqual([])
    expect(parseTranscriptTurns('claude', '/nope/does/not/exist.jsonl')).toEqual([])
  })

  it('caps the number of turns', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ type: 'user', message: { role: 'user', content: `msg ${i}` } }))
    const p = tmpFile('big.jsonl', jl(...many))
    const turns = parseTranscriptTurns('claude', p)
    expect(turns.length).toBeLessThanOrEqual(200)
  })
})
