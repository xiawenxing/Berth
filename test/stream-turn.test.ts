import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { setDocStoreStore } from '../src/data/docstore'
import { prepareStreamTurn } from '../src/server/stream-turn'

const roots: string[] = []

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function useDocsRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'berth-stream-turn-'))
  roots.push(root)
  setDocStoreStore({ getSetting: (key) => key === 'docsRoot' ? root : null })
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('prepareStreamTurn image placeholders', () => {
  it('replaces an image marker with the saved image path in-place', () => {
    const root = useDocsRoot()
    const prepared = prepareStreamTurn('look here [Image #1] then continue', [
      { name: 'shot.png', dataUrl: 'data:image/png;base64,QUJD', marker: '[Image #1]' },
    ])

    expect(prepared.displayText).toBe('look here [Image #1] then continue')
    expect(prepared.agentText).toMatch(new RegExp(`^look here ${escapeRegExp(root)}/assets/shotpng-\\d+-\\d+\\.png then continue$`))
    expect(prepared.agentText).not.toContain('Attached images')
  })

  it('keeps the legacy appended attachment block when there is no marker', () => {
    const root = useDocsRoot()
    const prepared = prepareStreamTurn('look here', [
      { name: 'shot.png', dataUrl: 'data:image/png;base64,QUJD' },
    ])

    expect(prepared.displayText).toBe('look here\n\n已附加 1 张图片')
    expect(prepared.agentText).toMatch(new RegExp(`^look here\\n\\nAttached images:\\n1\\. ${escapeRegExp(root)}/assets/shotpng-\\d+-\\d+\\.png$`))
  })
})
