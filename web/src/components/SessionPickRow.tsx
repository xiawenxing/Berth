import { cn } from '@/lib/utils'
import { imagePathPlaceholderText, relTime } from '@/lib/format'
import { CliBadge } from '@/components/workspace/TaskCard'
import type { PreviewSession } from '@/lib/api'

/**
 * One selectable session row used by every import picker (ImportDialog, CliImportDialog,
 * ImportByIdDialog): a checkbox, the CLI badge, the title, and a relative timestamp. Optionally
 * shows the cwd (the per-CLI dialog groups by cwd so it omits it; flat lists can show it).
 */
export function SessionPickRow({
  session,
  checked,
  onToggle,
  showCwd = false,
}: {
  session: PreviewSession
  checked: boolean
  onToggle: () => void
  showCwd?: boolean
}) {
  const displayTitle = imagePathPlaceholderText(session.title, '(未命名)')
  return (
    <button
      onClick={onToggle}
      className={cn(
        'flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors',
        checked ? 'border-brand/50 bg-brand/5' : 'border-transparent hover:bg-muted/40',
      )}
    >
      <span
        className={cn(
          'flex h-[15px] w-[15px] flex-none items-center justify-center rounded border text-[10px]',
          checked ? 'border-brand bg-brand text-brand-foreground' : 'border-border text-transparent',
        )}
      >
        ✓
      </span>
      <CliBadge cli={session.cli} />
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground" title={displayTitle}>
        {displayTitle}
        {showCwd && session.cwd && (
          <span className="ml-1.5 font-mono text-[10.5px] text-text-dim" title={session.cwd}>
            {session.cwd}
          </span>
        )}
      </span>
      <span className="flex-none text-[10.5px] text-text-dim">{relTime(session.updatedAt)}</span>
    </button>
  )
}
