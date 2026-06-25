import { useState } from 'react'

export const SESSION_SHOW_MORE_PAGE = 8

/**
 * Client-side "show more / show less" pagination over a flat list of length `total`.
 * `initial` is the collapsed cap (defaults to one page). "more" reveals one more `page`
 * (capped at `total`); once nothing is hidden, the same action ("less") resets to `initial`.
 *
 *   const { visibleCount, hidden, paginated, expanded, toggle } = useShowMore(rows.length)
 *   rows.slice(0, visibleCount)
 *   {paginated && <ShowMoreToggle hidden={hidden} total={rows.length} expanded={expanded} onToggle={toggle} />}
 */
export function useShowMore(
  total: number,
  initial = SESSION_SHOW_MORE_PAGE,
  page = SESSION_SHOW_MORE_PAGE,
) {
  const [shown, setShown] = useState(initial)
  const visibleCount = Math.min(shown, total)
  const hidden = total - visibleCount
  const paginated = total > initial
  const expanded = hidden === 0 && shown > initial
  const toggle = () => setShown((v) => (total - Math.min(v, total) > 0 ? Math.min(v + page, total) : initial))
  return { visibleCount, hidden, paginated, expanded, toggle }
}
