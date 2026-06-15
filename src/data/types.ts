// Canonical data-layer types. Berth owns tasks/projects/docs internally; external systems
// (Feishu bitable, Meego, …) are sync adapters selected by config. No external schema leaks here.

export type SyncMode = 'auto' | 'manual'

/** The fields of a task that are shared with / synced to external sources. */
export interface TaskFields {
  title: string
  status: string | null
  priority: string | null
  project: string | null          // project display name for external sync / UI display
  detailDoc: string | null        // internal doc ref (path relative to docsRoot), NOT an obsidian link
  progress: string | null         // short progress snapshot for list/manifest
}

export interface Task extends TaskFields {
  id: string                      // Berth-native uuid
  projectId: string | null        // stable project id; tasks never key their relationship by name
  updatedAt: number               // ms; bumped on every local edit
  syncedAt: number                // ms of last successful sync of this row
  deleted: boolean                // soft delete (so deletes can propagate on sync)
}

export interface Project { id: string; name: string; hue?: string }

export interface DataSourceRow {
  id: string
  kind: string                    // 'feishu-bitable' | 'meego'
  label: string | null
  config: any                     // parsed config_json (connection params + field map)
  pullMode: SyncMode
  pushMode: SyncMode
  enabled: boolean
}

export interface ExternalRef {
  entityKind: 'task' | 'project'
  entityId: string                // berth id (task uuid / project name)
  sourceId: string
  externalId: string              // recordId / meego workitem id
  externalHash: string | null     // hash of the external snapshot at last sync
  externalUpdatedAt: number | null
}

export interface Conflict {
  id: string
  entityKind: 'task' | 'project'
  entityId: string
  sourceId: string
  berth: any                      // berth-side snapshot at detection
  external: any                   // external-side snapshot at detection
  detectedAt: number
  resolved: boolean
}

/** Normalized record an adapter produces on pull / consumes on push. */
export interface NormalizedRecord {
  externalId: string
  fields: TaskFields
  externalUpdatedAt?: number
  hash: string                    // stable hash of external content → cheap change detection
}
