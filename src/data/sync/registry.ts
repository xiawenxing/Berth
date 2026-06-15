import type { DataSourceAdapter, AdapterAvailability } from './adapter'
import { MeegoAdapter } from './meego'
import { FeishuBitableAdapter } from './feishu'

// Adapter instances are stateless (all state comes from the source row passed per call), so a
// singleton per kind is fine.
const ADAPTERS: Record<string, DataSourceAdapter> = {
  'feishu-bitable': new FeishuBitableAdapter(),
  'meego': new MeegoAdapter(),
}

export function getAdapter(kind: string): DataSourceAdapter {
  const a = ADAPTERS[kind]
  if (!a) throw new Error(`unknown data-source kind: ${kind}`)
  return a
}

/** All registered adapter kinds. */
export function adapterKinds(): string[] {
  return Object.keys(ADAPTERS)
}

/**
 * Resolve each adapter's availability. An adapter without `checkAvailable` is treated as available.
 * Pure over the passed map so it can be unit-tested with fakes.
 */
export async function computeCapabilities(
  adapters: Record<string, DataSourceAdapter>,
): Promise<Record<string, AdapterAvailability>> {
  const out: Record<string, AdapterAvailability> = {}
  for (const [kind, a] of Object.entries(adapters)) {
    out[kind] = a.checkAvailable ? await a.checkAvailable() : { available: true }
  }
  return out
}

/** Availability of every registered adapter — backs `GET /api/capabilities`. */
export function adapterCapabilities(): Promise<Record<string, AdapterAvailability>> {
  return computeCapabilities(ADAPTERS)
}
