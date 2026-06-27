export type AgentCli = 'claude' | 'codex' | 'coco'

/** A single physical file/dir found in one CLI's store. */
export interface PhysicalSession {
  cli: AgentCli
  physicalId: string          // the UUID in the filename/meta
  storePath: string           // absolute path to the session file/dir
  cwd: string | null          // from the session's own meta
  title: string | null
  updatedAt: number           // epoch seconds
  kind: 'native' | 'import-stub' | 'subagent'
  parentId?: string           // for kind=subagent: the parent session UUID
  importedFromPath?: string   // for kind=import-stub: the Claude source_path
}

/** One logical conversation, possibly spanning two physical copies. */
export interface LogicalSession {
  sessionId: string           // app-canonical id (= contentSource physicalId)
  cli: AgentCli               // the CLI whose content is canonical
  cwd: string | null
  title: string | null
  updatedAt: number
  contentSourcePath: string | null  // where readable transcript lives (null if deleted)
  resume?: { cli: AgentCli; id: string }  // command target (set for all real sessions; optional for type-honesty)
  copies: PhysicalSession[]
  deleted: boolean            // contentSource file missing
  launching?: boolean         // transient: an in-flight Berth launch (live pty, no jsonl yet) — NOT on
                              // disk, synthesized into the visible set only (never persisted). See
                              // `synthLaunchingSessions`.
}

export interface LedgerRecord {
  sourcePath: string          // Claude jsonl
  contentSha256: string
  importedThreadId: string    // Codex rollout uuid
  importedAt: number
}

export interface LaunchIntent {
  id: string                 // uuid; also the pre-minted sessionId for claude/coco
  cli: AgentCli
  cwd: string
  projectId: string | null   // stable project id (matches /api/projects[].id)
  todoKey: string | null     // bitable record_id when task-bound
  sessionId: string | null   // known immediately for claude/coco; null for codex until reconciled
  createdAt: number          // epoch seconds
  bound: boolean
}
