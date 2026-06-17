import { useEffect, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Dimmed backdrop that closes on left-area click + Esc. */
function useEsc(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
}

/** Centered modal dialog (装载台 / 新建任务 / 新建项目). */
export function Dialog({
  open,
  onClose,
  children,
  width = 480,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  width?: number
}) {
  useEsc(onClose)
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="max-h-[88vh] overflow-y-auto rounded-lg border border-border bg-popover shadow-2xl"
        style={{ width: `min(${width}px, 92vw)` }}
      >
        {children}
      </div>
    </div>
  )
}

/** Right-side drawer (会话). Slides over; dim-left closes. */
export function Drawer({
  open,
  onClose,
  children,
  width = '60vw',
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  width?: string
}) {
  useEsc(onClose)
  return (
    <div
      className={cn('fixed inset-0 z-[140] bg-black/42 transition-opacity', open ? 'opacity-100' : 'pointer-events-none opacity-0')}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={cn(
          'absolute right-0 top-0 flex h-full flex-col border-l border-border bg-canvas shadow-2xl transition-transform duration-300',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        style={{ width, minWidth: 560, maxWidth: '100vw' }}
      >
        {children}
      </div>
    </div>
  )
}
