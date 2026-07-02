import { useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// Tailwind's `animate-spin` is a 1s linear rotation. We reuse it but pin every spinner to a single
// shared rotation phase.
const SPIN_PERIOD_MS = 1000

/**
 * The one loading spinner. Every running-session lamp, 创建中 placeholder, title-generation and
 * 小结 indicator routes through here so they all rotate in lockstep.
 *
 * Why: `animate-spin` anchors each element's animation to the moment it mounts. Rows mount at
 * different times, so a field of independent spinners freezes at random angles — that "角度不一致很乱"
 * look. The fix is a negative `animation-delay` equal to the current offset into the period: an
 * element mounting at wall-time T lands on phase (T % period), which is identical for every spinner
 * regardless of when it mounted. Same period + same phase ⇒ they stay synchronized forever.
 *
 * The phase is captured ONCE at mount in a ref. Running-session rows re-render on every /status WS
 * `act` message (live.rev bump); reading performance.now() on each render re-seeded animationDelay
 * and jolted the CSS rotation, so the spinner visibly jumped ("闪动跳动"). The mount-time phase is
 * still wall-clock-aligned, so spinners stay in lockstep without re-seeding on every render.
 */
export function Spinner({ size = 12, className, label }: { size?: number; className?: string; label?: string }) {
  const delayRef = useRef<string>()
  if (delayRef.current === undefined) {
    const now = typeof performance !== 'undefined' ? performance.now() : 0
    delayRef.current = `-${now % SPIN_PERIOD_MS}ms`
  }
  const style = { animationDelay: delayRef.current }
  return (
    <Loader2
      size={size}
      className={cn('flex-none animate-spin', className)}
      style={style}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  )
}
