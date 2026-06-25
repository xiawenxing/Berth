import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Shared "展开更多 (N) / 收起" toggle. Pure presentation — pair with useShowMore().
 * `showTotal` appends "/ 共 M" (used by the import dialog). `className` lets each call site
 * keep its own inset/spacing. stopPropagation is guarded so it is safe inside click-to-expand
 * subtrees (e.g. TaskCard) and dialogs alike.
 */
export function ShowMoreToggle({
  hidden,
  total,
  expanded,
  onToggle,
  className,
  showTotal,
}: {
  hidden: number
  total: number
  expanded: boolean
  onToggle: () => void
  className?: string
  showTotal?: boolean
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      className={cn(
        'flex items-center gap-1 text-left text-[11px] font-medium text-text-dim hover:text-brand',
        className,
      )}
    >
      <ChevronDown size={12} className={cn('transition-transform', expanded && 'rotate-180')} />
      {hidden > 0 ? `展开更多 (${hidden}${showTotal ? ` / 共 ${total}` : ''})` : '收起'}
    </button>
  )
}
