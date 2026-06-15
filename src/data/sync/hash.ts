import { createHash } from 'node:crypto'
import type { Task, TaskFields } from '../types'

/**
 * Stable content hash of a task's synced fields. Used on BOTH sides:
 *  - adapters hash the normalized (internal-ref) fields they pull, storing it as external_hash;
 *  - the engine hashes a Berth task's fields on push, storing the same value.
 * So a clean round-trip (push then pull) yields an equal hash → no false "external changed".
 */
export function hashFields(f: TaskFields): string {
  return createHash('sha1')
    .update(JSON.stringify([f.title, f.status, f.priority, f.project, f.detailDoc, f.progress]))
    .digest('hex')
}

export function fieldsOf(t: Task): TaskFields {
  return { title: t.title, status: t.status, priority: t.priority, project: t.project, detailDoc: t.detailDoc, progress: t.progress }
}
