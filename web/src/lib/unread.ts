import type { ShipStatus } from './types'

export type LiveActivity = 'running' | 'settled' | undefined

export const UNREAD_EPOCH_KEY = 'berth-unread-epoch'

export interface ShipStatusInput {
  activity?: LiveActivity
  explicitUnread?: boolean
  updatedAt?: number
  lastSeen?: number
  unreadEpoch?: number
}

export function contentIsUnread(input: ShipStatusInput): boolean {
  if (input.explicitUnread) return true
  const updatedAt = input.updatedAt ?? 0
  if (updatedAt <= 0) return false
  const lastSeen = input.lastSeen ?? 0
  if (updatedAt <= lastSeen) return false

  // Sessions opened in Berth have a last-seen timestamp, so their unread state can be recovered from
  // transcript updatedAt after a server restart. For never-opened sessions, use a first-run baseline
  // so adopting an existing CLI store doesn't mark every historical session unread.
  return lastSeen > 0 || updatedAt > (input.unreadEpoch ?? 0)
}

export function resolveShipStatus(input: ShipStatusInput): ShipStatus {
  if (input.activity === 'running') return 'sail'
  if (contentIsUnread(input)) return 'dock'
  return 'moored'
}
