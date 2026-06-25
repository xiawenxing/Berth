import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useShowMore } from './paging'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

type Api = ReturnType<typeof useShowMore>

function mount(total: number, initial?: number, page?: number) {
  let api!: Api
  function Probe() {
    api = useShowMore(total, initial, page)
    return null
  }
  act(() => {
    root.render(<Probe />)
  })
  return {
    get: () => api,
    run: (fn: (a: Api) => void) =>
      act(() => {
        fn(api)
      }),
  }
}

describe('useShowMore', () => {
  it('short list (<= initial) is not paginated and offers no controls', () => {
    const h = mount(5)
    expect(h.get().paginated).toBe(false)
    expect(h.get().hidden).toBe(0)
    expect(h.get().canCollapse).toBe(false)
    expect(h.get().visibleCount).toBe(5)
  })

  it('collapsed state shows only "more", never "collapse"', () => {
    const h = mount(20)
    expect(h.get().paginated).toBe(true)
    expect(h.get().visibleCount).toBe(8)
    expect(h.get().hidden).toBe(12)
    expect(h.get().canCollapse).toBe(false)
  })

  it('ROOT-CAUSE: after a single partial load-more, collapse is already available', () => {
    const h = mount(20) // initial 8, page 8 → one click reveals 16, still 4 hidden
    h.run((a) => a.loadMore())
    expect(h.get().visibleCount).toBe(16)
    expect(h.get().hidden).toBe(4) // still more to show
    expect(h.get().canCollapse).toBe(true) // ...AND collapse must already be offered
  })

  it('loadMore caps at total; collapse resets to initial', () => {
    const h = mount(20)
    h.run((a) => a.loadMore())
    h.run((a) => a.loadMore()) // 16 → 20 (capped)
    expect(h.get().visibleCount).toBe(20)
    expect(h.get().hidden).toBe(0)
    expect(h.get().canCollapse).toBe(true)
    h.run((a) => a.collapse())
    expect(h.get().visibleCount).toBe(8)
    expect(h.get().hidden).toBe(12)
    expect(h.get().canCollapse).toBe(false)
  })

  it('honors a custom initial cap (session-list limit)', () => {
    const h = mount(10, 4) // initial/limit 4, page default 8
    expect(h.get().visibleCount).toBe(4)
    expect(h.get().canCollapse).toBe(false)
    h.run((a) => a.loadMore()) // 4 → 12 capped to 10
    expect(h.get().visibleCount).toBe(10)
    expect(h.get().hidden).toBe(0)
    expect(h.get().canCollapse).toBe(true)
  })
})
