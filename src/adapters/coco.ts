import fg from 'fast-glob'
import { readFileSync } from 'node:fs'
import type { PhysicalSession } from '../types'

export function listCocoSessions(root: string): PhysicalSession[] {
  const metas = fg.sync('sessions/*/session.json', { cwd: root, absolute: true })
  const out: PhysicalSession[] = []
  for (const storePath of metas) {
    const j = JSON.parse(readFileSync(storePath, 'utf8'))
    if (!j.id) continue
    out.push({ cli: 'coco', physicalId: j.id, storePath,
      cwd: j.metadata?.cwd ?? null, title: j.metadata?.title ?? null,
      updatedAt: Math.floor(new Date(j.updated_at ?? 0).getTime() / 1000) || 0, kind: 'native' })
  }
  return out
}
