import { cn } from '@/lib/utils'

export function Switch({
  checked,
  onChange,
  disabled = false,
  title,
  className,
}: {
  checked: boolean
  onChange: () => void
  disabled?: boolean
  title?: string
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      onClick={onChange}
      data-state={checked ? 'checked' : 'unchecked'}
      className={cn('berth-switch', className)}
    >
      <span className="berth-switch-thumb" />
    </button>
  )
}
