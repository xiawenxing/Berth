import { describe, it, expect } from 'vitest'
import { listCocoSessions } from '../src/adapters/coco'
const ROOT = new URL('./fixtures/coco/', import.meta.url).pathname
describe('coco adapter', () => {
  it('enumerates session dirs from session.json', () => {
    const s = listCocoSessions(ROOT)
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ cli: 'coco',
      physicalId: '6d5e72ab-aaaa-bbbb-cccc-000000000001', cwd: '/Users/me/Code/z', title: '翻译 X' })
  })
})
