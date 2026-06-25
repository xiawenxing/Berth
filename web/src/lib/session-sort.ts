import type { SessionRow } from './types'

const SHIP_RANK: Record<SessionRow['status'], number> = {
  dock: 0,
  sail: 1,
  moored: 2,
  idle: 3,
}

export function compareSessionRows(a: SessionRow, b: SessionRow): number {
  const byShip = SHIP_RANK[a.status] - SHIP_RANK[b.status]
  if (byShip !== 0) return byShip
  const byUpdatedAt = (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
  if (byUpdatedAt !== 0) return byUpdatedAt
  return a.id.localeCompare(b.id)
}

export function sortSessionRows(rows: SessionRow[]): SessionRow[] {
  return rows.slice().sort(compareSessionRows)
}
