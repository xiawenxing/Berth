import fg from 'fast-glob'
import { readFileSync } from 'node:fs'
import type { PhysicalSession } from '../types'
import { createMtimeCache, type MtimeCache } from './mtime-cache'

function buildCocoSession(storePath: string): PhysicalSession | null {
  const j = JSON.parse(readFileSync(storePath, 'utf8'))
  if (!j.id) return null
  return { cli: 'coco', physicalId: j.id, storePath,
    cwd: j.metadata?.cwd ?? null, title: j.metadata?.title ?? null,
    updatedAt: Math.floor(new Date(j.updated_at ?? 0).getTime() / 1000) || 0, kind: 'native' }
}

const cocoCache = createMtimeCache<PhysicalSession | null>()

export function listCocoSessions(root: string, cache: MtimeCache<PhysicalSession | null> = cocoCache): PhysicalSession[] {
  const metas = fg.sync('sessions/*/session.json', { cwd: root, absolute: true })
  const out: PhysicalSession[] = []
  for (const storePath of metas) {
    const sess = cache.resolve(storePath, () => buildCocoSession(storePath))
    if (sess) out.push(sess)
  }
  cache.prune(metas)
  return out
}
