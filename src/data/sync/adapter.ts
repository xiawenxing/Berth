import type { DataSourceRow, NormalizedRecord, Task, TaskFields } from '../types'

/** Ambient context an adapter may need that isn't part of a single source's config. */
export interface AdapterContext {
  docsRoot: string   // adapters that translate internal doc refs to/from external formats need this
}

/** Whether an adapter's required external tooling is present on this machine. */
export interface AdapterAvailability {
  available: boolean
  reason?: string   // human-readable explanation when unavailable (shown in the UI)
}

/** Result of turning a user-pasted URL into a ready-to-save data source (config stays opaque to UI). */
export interface ConnectResult {
  id: string        // stable source id derived from the parsed target (re-connect updates in place)
  label: string     // human-friendly name shown in the UI
  config: any       // the auto-derived connection config (hidden from the user)
}

/**
 * The seam (切面). Every external data source (Feishu bitable, Meego, …) implements this.
 * Adapters are the ONLY code that knows an external system's shape — its ids, field names, link
 * formats. They are selected by config (kind), never hardwired into the core.
 */
export interface DataSourceAdapter {
  readonly kind: string

  /**
   * Optional: report whether the external tooling this adapter needs is installed on this machine.
   * Adapters that depend on a host CLI (e.g. Feishu → `lark-cli`) implement this so the UI can
   * hide/disable an integration the user can't use. Omitting it means "always available".
   */
  checkAvailable?(): Promise<AdapterAvailability>

  /** Read all task records from the external source, normalized to Berth's domain fields. */
  pullTasks(src: DataSourceRow, ctx: AdapterContext): Promise<NormalizedRecord[]>

  /** Create an external record from a Berth task; return the new external id. */
  createTask(src: DataSourceRow, task: Task, ctx: AdapterContext): Promise<string>

  /** Update an existing external record. */
  updateTask(src: DataSourceRow, externalId: string, patch: Partial<TaskFields>, ctx: AdapterContext): Promise<void>

  /** Delete (or tombstone) an external record. */
  deleteTask(src: DataSourceRow, externalId: string, ctx: AdapterContext): Promise<void>

  /** Optional: read the source's project/domain options. */
  pullProjects?(src: DataSourceRow, ctx: AdapterContext): Promise<{ name: string; hue?: string }[]>

  /** Optional: ensure a project/domain option exists on the source. */
  ensureProjectOption?(src: DataSourceRow, name: string, hue: string | undefined, ctx: AdapterContext): Promise<void>

  /**
   * Optional: turn a user-pasted URL into a ready-to-save source by parsing it + introspecting the
   * remote schema (so the user never hand-edits config). Adapters that support paste-to-connect
   * implement this; the UI offers it for those kinds.
   */
  connectFromUrl?(url: string, ctx: AdapterContext): Promise<ConnectResult>
}
