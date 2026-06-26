import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Shared "展开更多 (N) / 收起" controls — pure presentation, pair with useShowMore().
 * Renders 展开更多 while `hidden > 0` and 收起 while `canCollapse`; a partially-expanded long
 * list shows BOTH side by side. `showTotal` appends "/ 共 M" (used by the import dialog).
 * `className` lets each call site keep its own inset/spacing. stopPropagation is guarded so the
 * buttons are safe inside click-to-expand subtrees (e.g. TaskCard) and dialogs alike.
 */
export function ShowMoreToggle({
  hidden,
  total,
  canCollapse,
  onMore,
  onCollapse,
  className,
  showTotal,
}: {
  hidden: number
  total: number
  canCollapse: boolean
  onMore: () => void
  onCollapse: () => void
  className?: string
  showTotal?: boolean
}) {
  const link = 'flex items-center gap-1 text-left text-[11px] font-medium text-text-dim hover:text-brand'
  return (
    <div className={cn('flex items-center gap-3', className)}>
      {hidden > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onMore()
          }}
          className={link}
        >
          <ChevronDown size={12} /> 展开更多 ({hidden}
          {showTotal ? ` / 共 ${total}` : ''})
        </button>
      )}
      {canCollapse && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onCollapse()
          }}
          className={link}
        >
          <ChevronUp size={12} /> 收起
        </button>
      )}
    </div>
  )
}
