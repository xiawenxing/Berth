import type { AgentModelCatalog } from '@/lib/api'
import { cn } from '@/lib/utils'

interface AgentModelSelectProps {
  value: string
  catalog?: AgentModelCatalog
  ariaLabel: string
  className?: string
  onChange: (value: string) => void
}

function optionLabel(id: string, label: string): string {
  return label && label !== id ? `${label} (${id})` : id
}

/**
 * A real select rather than input+datalist: opening it always exposes the complete CLI-probed
 * catalog instead of letting the browser filter options by the currently saved value.
 */
export function AgentModelSelect({ value, catalog, ariaLabel, className, onChange }: AgentModelSelectProps) {
  const models = catalog?.models ?? []
  const currentIsProbed = !value || models.some((model) => model.id === value)

  return (
    <select
      value={value}
      aria-label={ariaLabel}
      title={catalog?.source === 'cli'
        ? '已探测 CLI 模型列表'
        : catalog?.source === 'help'
          ? 'CLI help 中的模型别名'
          : catalog
            ? '模型目录探测失败'
            : '正在探测 CLI 模型列表'}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        'rounded-md border border-border bg-card px-2 py-1 text-[12px] text-foreground outline-none',
        className,
      )}
    >
      <option value="">CLI 默认模型</option>
      {!currentIsProbed && (
        <option value={value}>{value}（当前配置，未在探测目录中）</option>
      )}
      {models.map((model) => (
        <option key={model.id} value={model.id}>
          {optionLabel(model.id, model.label)}
        </option>
      ))}
      {catalog && !catalog.ok && <option disabled>模型目录探测失败</option>}
      {catalog?.ok && models.length === 0 && <option disabled>未探测到可选模型</option>}
    </select>
  )
}
