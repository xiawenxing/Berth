import { useState } from 'react'

export const SESSION_SHOW_MORE_PAGE = 8

/**
 * Client-side "show more / show less" pagination over a flat list of length `total`.
 * `initial` is the collapsed cap (defaults to one page). `loadMore` reveals one more `page`
 * (capped at `total`); `collapse` snaps straight back to `initial`.
 *
 * `canCollapse` is true as soon as the list is shown beyond `initial` — so 收起 is offered
 * the moment you expand at all, NOT only once everything is visible. For a long list a partial
 * expansion therefore offers BOTH 展开更多 (hidden > 0) and 收起 (canCollapse) at once.
 *
 *   const { visibleCount, hidden, paginated, canCollapse, loadMore, collapse } = useShowMore(rows.length)
 *   rows.slice(0, visibleCount)
 *   {paginated && (
 *     <ShowMoreToggle hidden={hidden} total={rows.length} canCollapse={canCollapse} onMore={loadMore} onCollapse={collapse} />
 *   )}
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
  const canCollapse = visibleCount > initial
  const loadMore = () => setShown((v) => Math.min(v + page, total))
  const collapse = () => setShown(initial)
  return { visibleCount, hidden, paginated, canCollapse, loadMore, collapse }
}
