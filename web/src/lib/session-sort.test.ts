import { describe, expect, it } from 'vitest'
import { sortSessionRows } from './session-sort'
import type { SessionRow } from './types'

function row(id: string, status: SessionRow['status'], updatedAt: number): SessionRow {
  return { id, cli: 'claude', title: id, cwd: '/x', time: '', status, updatedAt }
}

describe('sortSessionRows', () => {
  it('orders unread, then running, then recent activity', () => {
    const rows = [
      row('read-new', 'moored', 300),
      row('running-old', 'sail', 100),
      row('unread-old', 'dock', 100),
      row('running-new', 'sail', 200),
      row('unread-new', 'dock', 200),
      row('read-old', 'moored', 100),
    ]

    expect(sortSessionRows(rows).map((r) => r.id)).toEqual([
      'unread-new',
      'unread-old',
      'running-new',
      'running-old',
      'read-new',
      'read-old',
    ])
  })
})
