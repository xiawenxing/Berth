import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

/** A popover portaled to <body> and fixed-positioned under `anchor`, so it escapes the card's
 *  overflow-hidden and the column body's overflow-y-auto. Closes on outside-click (anchor
 *  included, so the trigger toggles cleanly) and Esc; flips above when near the viewport bottom. */
export function AnchoredPopover({
  anchor,
  onClose,
  width,
  children,
}: {
  anchor: RefObject<HTMLElement | null>
  onClose: () => void
  width: number
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current?.getBoundingClientRect()
      if (!a) return
      const H = ref.current?.offsetHeight ?? 280
      const left = Math.max(8, Math.min(a.right - width, window.innerWidth - width - 8))
      const below = a.bottom + 4
      const top = below + H > window.innerHeight - 8 ? Math.max(8, a.top - H - 4) : below
      setPos({ top, left })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor, width])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose, anchor])

  return createPortal(
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width, visibility: pos ? 'visible' : 'hidden' }}
      className="anim-pop elev-3 fixed z-50 rounded-md border border-border bg-popover p-1"
    >
      {children}
    </div>,
    document.body,
  )
}

export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-bold uppercase tracking-wide text-text-dim">{children}</div>
)

export const MenuItem = ({ children, onClick, danger, disabled }: { children: ReactNode; onClick: (e: React.MouseEvent) => void; danger?: boolean; disabled?: boolean }) => (
  <button
    disabled={disabled}
    onClick={onClick}
    className={cn(
      'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] transition-colors duration-[120ms] hover:bg-accent disabled:pointer-events-none disabled:opacity-55',
      danger ? 'text-destructive hover:bg-destructive/10' : 'text-foreground',
    )}
  >
    {children}
  </button>
)
