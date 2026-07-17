import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Resolve the on-disk stores owned by the agent CLIs. These are intentionally separate from
 * BERTH_HOME: Berth may be isolated while continuing to discover the user's real CLI sessions.
 * BERTH_*_ROOT is an escape hatch for portable installs and non-standard CLI layouts.
 */
function configured(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = env[key]?.trim()
  return value || fallback
}

export function codexHome(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return configured(env, 'BERTH_CODEX_ROOT', configured(env, 'CODEX_HOME', join(home, '.codex')))
}

export function claudeProjectsRoot(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return configured(env, 'BERTH_CLAUDE_ROOT', join(home, '.claude', 'projects'))
}

export function cocoStoreRoot(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  const fallback = platform === 'darwin'
    ? join(home, 'Library', 'Caches', 'coco')
    : join(env.XDG_CACHE_HOME?.trim() || join(home, '.cache'), 'coco')
  return configured(env, 'BERTH_COCO_ROOT', fallback)
}

export function agentStoreRoots(env: NodeJS.ProcessEnv = process.env, home = homedir(), platform: NodeJS.Platform = process.platform) {
  return {
    claudeRoot: claudeProjectsRoot(env, home) + '/',
    codexRoot: codexHome(env, home) + '/',
    cocoRoot: cocoStoreRoot(env, home, platform) + '/',
  }
}
