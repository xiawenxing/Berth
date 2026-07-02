import type { AgentIntegrationStatus, AppUpdateStatus } from './api'

export type SettingsNoticeKind = 'app-update' | 'integration-install' | 'integration-update'

export interface SettingsNotice {
  kind: SettingsNoticeKind
  title: string
  badge: string
  hint: string
}

export function isIntegrationMissing(status: AgentIntegrationStatus | null | undefined): boolean {
  if (!status?.needsAction) return false
  if (status.cli.state !== 'missing') return false
  if (!status.skills.bundled || status.skills.state === 'missing') return true
  const targets = status.skills.targets
  if (targets.length === 0) return true
  return targets.every((target) => target.state === 'missing')
}

export function settingsNotice(
  appUpdate: AppUpdateStatus | null | undefined,
  integration: AgentIntegrationStatus | null | undefined,
): SettingsNotice | null {
  if (appUpdate?.updateAvailable) {
    return { kind: 'app-update', title: 'Berth 有新版本', badge: '更新', hint: '点击前往设置下载' }
  }
  if (!integration?.needsAction) return null
  if (isIntegrationMissing(integration)) {
    return { kind: 'integration-install', title: '建议安装 Agent 集成', badge: '安装', hint: 'CLI / skill 未安装' }
  }
  return { kind: 'integration-update', title: 'Agent 集成可更新', badge: '集成', hint: 'CLI / skill 可更新' }
}

export function integrationTitle(status: AgentIntegrationStatus | null | undefined): string {
  return isIntegrationMissing(status) ? '建议安装 Agent 集成' : 'Agent 集成可更新'
}

export function integrationActionLabel(status: AgentIntegrationStatus | null | undefined, busy: boolean): string {
  if (busy) return isIntegrationMissing(status) ? '安装中…' : '更新中…'
  return isIntegrationMissing(status) ? '安装' : '更新'
}

export function integrationSummary(status: AgentIntegrationStatus | null): string {
  if (!status) return '正在检查本机 CLI 与 agent skill'
  if (isIntegrationMissing(status)) {
    return '建议安装本机 CLI 和 berth-tasks skill，agent 才能直接使用 berth task / berth project'
  }

  const parts: string[] = []
  if (status.cli.state === 'missing') parts.push('CLI 未安装')
  if (status.cli.state === 'outdated') parts.push(`CLI 不是当前版本 ${status.currentVersion}`)
  if (!status.skills.bundled) parts.push('当前 App 未包含 berth-tasks skill')
  else {
    const missing = status.skills.targets.filter((target) => target.state === 'missing').length
    const outdated = status.skills.targets.filter((target) => target.state === 'outdated').length
    if (missing) parts.push(`${missing} 个 agent 未安装 skill`)
    if (outdated) parts.push(`${outdated} 个 agent 的 skill 需要更新`)
  }
  return parts.length ? parts.join(' · ') : 'Agent 集成已是当前版本'
}
