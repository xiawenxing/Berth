import { describe, expect, it } from 'vitest'
import type { AgentIntegrationStatus, AppUpdateStatus } from './api'
import { integrationActionLabel, integrationSummary, integrationTitle, isIntegrationMissing, settingsNotice } from './settings-status'

function integration(patch: Partial<AgentIntegrationStatus> = {}): AgentIntegrationStatus {
  return {
    currentVersion: '2.0.4',
    cli: {
      state: 'current',
      currentVersion: '2.0.4',
      installedVersion: '2.0.4',
      path: '/usr/local/bin/berth',
      pathInEnv: true,
      managed: true,
    },
    skills: {
      state: 'current',
      bundled: true,
      targets: [
        { agent: 'codex', dir: '/tmp/codex/skills', state: 'current' },
      ],
    },
    needsAction: false,
    ...patch,
  }
}

function update(patch: Partial<AppUpdateStatus> = {}): AppUpdateStatus {
  return {
    currentVersion: '2.0.4',
    latestVersion: '2.0.5',
    updateAvailable: true,
    releaseUrl: 'https://example.test/release',
    checkedAt: 1,
    error: null,
    ...patch,
  }
}

describe('settingsNotice', () => {
  it('prioritizes app updates over integration work', () => {
    const notice = settingsNotice(update(), integration({
      needsAction: true,
      cli: { ...integration().cli, state: 'missing', installedVersion: null },
    }))

    expect(notice).toEqual({ kind: 'app-update', title: 'Berth 有新版本', badge: '更新', hint: '点击前往设置下载' })
  })

  it('labels a completely missing CLI and skill as install recommended', () => {
    const status = integration({
      needsAction: true,
      cli: { ...integration().cli, state: 'missing', installedVersion: null, pathInEnv: false },
      skills: {
        state: 'missing',
        bundled: true,
        targets: [
          { agent: 'codex', dir: '/tmp/codex/skills', state: 'missing' },
          { agent: 'claude', dir: '/tmp/claude/skills', state: 'missing' },
        ],
      },
    })

    expect(isIntegrationMissing(status)).toBe(true)
    expect(settingsNotice(null, status)).toEqual({ kind: 'integration-install', title: '建议安装 Agent 集成', badge: '安装', hint: 'CLI / skill 未安装' })
    expect(integrationTitle(status)).toBe('建议安装 Agent 集成')
    expect(integrationActionLabel(status, false)).toBe('安装')
    expect(integrationSummary(status)).toContain('建议安装本机 CLI 和 berth-tasks skill')
  })

  it('labels outdated integration as an update instead of install', () => {
    const status = integration({
      needsAction: true,
      cli: { ...integration().cli, state: 'outdated', installedVersion: '2.0.3' },
      skills: {
        state: 'outdated',
        bundled: true,
        targets: [
          { agent: 'codex', dir: '/tmp/codex/skills', state: 'outdated' },
        ],
      },
    })

    expect(isIntegrationMissing(status)).toBe(false)
    expect(settingsNotice(null, status)).toEqual({ kind: 'integration-update', title: 'Agent 集成可更新', badge: '集成', hint: 'CLI / skill 可更新' })
    expect(integrationTitle(status)).toBe('Agent 集成可更新')
    expect(integrationActionLabel(status, true)).toBe('更新中…')
    expect(integrationSummary(status)).toBe('CLI 不是当前版本 2.0.4 · 1 个 agent 的 skill 需要更新')
  })

  it('stays quiet when everything is current', () => {
    expect(settingsNotice(update({ updateAvailable: false }), integration())).toBeNull()
  })
})
