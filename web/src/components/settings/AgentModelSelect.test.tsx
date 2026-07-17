import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentModelCatalog } from '@/lib/api'
import { AgentModelSelect } from './AgentModelSelect'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

const catalog: AgentModelCatalog = {
  cli: 'codex',
  ok: true,
  source: 'cli',
  models: [
    { id: 'gpt-5.5', label: 'GPT-5.5' },
    { id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol' },
    { id: 'gpt-5.4', label: 'GPT-5.4' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4-Mini' },
  ],
}

function render(value: string, onChange = vi.fn(), modelCatalog: AgentModelCatalog | undefined = catalog) {
  act(() => {
    root.render(
      <AgentModelSelect
        value={value}
        catalog={modelCatalog}
        ariaLabel="Codex 默认模型"
        onChange={onChange}
      />,
    )
  })
  return { select: host.querySelector('select') as HTMLSelectElement, onChange }
}

describe('AgentModelSelect', () => {
  it('renders the complete probed catalog even when a model is already selected', () => {
    const { select } = render('gpt-5.4')

    expect(select.value).toBe('gpt-5.4')
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      '',
      'gpt-5.5',
      'gpt-5.6-sol',
      'gpt-5.4',
      'gpt-5.4-mini',
    ])
  })

  it('preserves a saved custom value that is absent from the current catalog', () => {
    const { select } = render('custom-model')

    expect(select.value).toBe('custom-model')
    expect(select.options[1].textContent).toContain('当前配置')
    expect(Array.from(select.options).map((option) => option.value)).toContain('gpt-5.6-sol')
  })

  it('emits the selected model and supports returning to the CLI default', () => {
    const onChange = vi.fn()
    const { select } = render('gpt-5.4', onChange)

    act(() => {
      select.value = 'gpt-5.6-sol'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onChange).toHaveBeenLastCalledWith('gpt-5.6-sol')

    act(() => {
      select.value = ''
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onChange).toHaveBeenLastCalledWith('')
  })
})
