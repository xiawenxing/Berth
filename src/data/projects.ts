import type { Project } from './types'

type Store = ReturnType<typeof import('../db/store').openStore>

/** List projects from the internal store (instant; no external latency). */
export function listProjects(store: Store): Project[] {
  return store.allProjects()
}

/** Create/upsert a project in the internal store. External push is the sync engine's job. */
export function createProject(store: Store, name: string, hue?: string): Project {
  const n = name.trim()
  if (!n) throw new Error('empty project name')
  const p = store.upsertProject({ name: n, hue })
  if (!p.id) throw new Error('project id missing')
  return { id: p.id, name: p.name, hue: p.hue }
}
