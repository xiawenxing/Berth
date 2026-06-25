import { describe, it, expect } from 'vitest'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from '../src/db/store'
import { DocStore } from '../src/data/docstore'
import { seedOnboarding, onboardingContent } from '../src/data/onboarding'

function fixtures() {
  const db = openStore(':memory:')
  const root = mkdtempSync(join(tmpdir(), 'berth-onboard-'))
  const docs = new DocStore(root)
  return { db, docs }
}

describe('onboarding seed', () => {
  it('seeds a guide project with its tasks on a fresh store', () => {
    const { db, docs } = fixtures()
    const created = seedOnboarding(db, docs, 'zh-CN', () => 1000)
    expect(created).toBe(true)
    const projects = db.allProjects()
    const name = onboardingContent('zh-CN').projectName
    expect(projects.map(p => p.name)).toContain(name)
    const tasks = db.allTasks()
    expect(tasks.length).toBe(4)
    const pid = projects.find(p => p.name === name)!.id
    expect(tasks.every(t => t.projectId === pid)).toBe(true)
  })

  it('writes a context doc for the project and each task', () => {
    const { db, docs } = fixtures()
    seedOnboarding(db, docs, 'zh-CN', () => 1000)
    for (const t of db.allTasks()) {
      expect(t.detailDoc).toBeTruthy()
      const abs = docs.resolveDocPath(t.detailDoc!)!
      expect(existsSync(abs)).toBe(true)
      expect(readFileSync(abs, 'utf8').length).toBeGreaterThan(0)
    }
    const pabs = docs.resolveDocPath(docs.projectDocRef(onboardingContent('zh-CN').projectName))!
    expect(existsSync(pabs)).toBe(true)
  })

  it('is idempotent — a second call seeds nothing', () => {
    const { db, docs } = fixtures()
    expect(seedOnboarding(db, docs, 'zh-CN', () => 1000)).toBe(true)
    expect(seedOnboarding(db, docs, 'zh-CN', () => 1000)).toBe(false)
    expect(db.allTasks().length).toBe(4)
    expect(db.allProjects().length).toBe(1)
  })

  it('does not resurrect the guide once shown, even after the user deletes it', () => {
    const { db, docs } = fixtures()
    expect(seedOnboarding(db, docs, 'zh-CN', () => 1000)).toBe(true)
    // User manually deletes the guide project + its tasks.
    for (const t of db.allTasks()) db.softDeleteTask(t.id, 2000)
    const p = db.allProjects()[0]
    if (p) db.deleteProject(p.id, 2000)
    expect(db.allTasks().length).toBe(0)
    // A later boot must NOT bring it back — the shown flag persists.
    expect(seedOnboarding(db, docs, 'zh-CN', () => 3000)).toBe(false)
    expect(db.allTasks().length).toBe(0)
    expect(db.allProjects().length).toBe(0)
  })

  it('respects locale for the guide project name', () => {
    const { db, docs } = fixtures()
    seedOnboarding(db, docs, 'en', () => 1000)
    expect(db.allProjects()[0].name).toBe(onboardingContent('en').projectName)
    expect(onboardingContent('en').projectName).not.toBe(onboardingContent('zh-CN').projectName)
  })

  it('the launch task doc carries an explicit directive for the launched agent', () => {
    const launch = onboardingContent('zh-CN').tasks.find(t => t.id === 'berth-guide-launch')!
    expect(launch.doc).toMatch(/自我介绍|复述/)
    expect(launch.priority).toBe('P1')
    const launchEn = onboardingContent('en').tasks.find(t => t.id === 'berth-guide-launch')!
    expect(launchEn.doc).toMatch(/introduce|repeat/i)
  })

  it('seeds tasks with varied status/priority to exercise the board', () => {
    const c = onboardingContent('zh-CN')
    expect(new Set(c.tasks.map(t => t.status)).size).toBeGreaterThan(1)
    expect(new Set(c.tasks.map(t => t.priority)).size).toBeGreaterThan(1)
  })

  it('falls back to the default status when a preferred status is not in the vocab', () => {
    const { db, docs } = fixtures()
    // Shrink the status vocab so '进行中' is gone; seed must still produce valid statuses.
    db.setSetting('taskStatuses', JSON.stringify(['待办', '已完成']))
    seedOnboarding(db, docs, 'zh-CN', () => 1000)
    for (const t of db.allTasks()) expect(['待办', '已完成']).toContain(t.status)
  })
})
