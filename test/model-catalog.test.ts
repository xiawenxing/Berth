import { describe, expect, it } from 'vitest'
import { parseClaudeModelAliasesFromHelp, parseCodexModelsJson, parseCocoModelsJson } from '../src/pty/model-catalog'

describe('pty/model-catalog parsers', () => {
  it('normalizes the codex debug model catalog', () => {
    const models = parseCodexModelsJson(JSON.stringify({
      models: [
        { slug: 'gpt-5.5', display_name: 'GPT-5.5', description: 'Frontier', visibility: 'list', base_instructions: 'large ignored blob' },
        { slug: 'hidden-model', display_name: 'Hidden', visibility: 'hidden' },
      ],
    }))
    expect(models).toEqual([{ id: 'gpt-5.5', label: 'GPT-5.5', description: 'Frontier' }])
  })

  it('normalizes coco models --json output', () => {
    const models = parseCocoModelsJson(JSON.stringify([
      { name: 'Doubao-Seed-Code', real_name: 'Doubao Seed Code', description: 'Context window: 184k', context_window: 184000 },
      { name: 'openrouter-1', description: 'Context window: 168k' },
    ]))
    expect(models).toEqual([
      { id: 'Doubao-Seed-Code', label: 'Doubao Seed Code', description: 'Context window: 184k', contextWindow: 184000 },
      { id: 'openrouter-1', label: 'openrouter-1', description: 'Context window: 168k', contextWindow: undefined },
    ])
  })

  it('extracts claude --model aliases from help text', () => {
    const models = parseClaudeModelAliasesFromHelp(" --model <model>  Provide an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet') or a model's full name (e.g. 'claude-fable-5').")
    expect(models.map(m => m.id)).toEqual(['fable', 'opus', 'sonnet'])
  })
})
