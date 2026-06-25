// First-run onboarding seed: a sample "guide" project whose tasks ARE the onboarding steps. Seeded
// once, only on a genuinely fresh install (gated by the caller on the first-run bootstrap), so an
// existing instance never gets the guide injected. Idempotent via the `onboarding-seeded` flag.
//
// Scope (decided with the owner): the core 4 steps — understand → import → launch → archive — with
// step 3 ("launch from a task") authored to be genuinely launchable: its detail doc carries an
// explicit directive so the launched agent demonstrates the task→session auto-submit chain.
import type { DocStore } from './docstore'
import { getTaskFieldConfig } from './task-config'
import type { Locale } from '../i18n'
import type { Task } from './types'

type Store = ReturnType<typeof import('../db/store').openStore>
type Now = () => number

export interface OnboardingTask {
  id: string
  title: string
  status: string        // canonical status value (vocab is not localized); validated against config
  priority: string
  doc: string           // full markdown body for tasks/<id>/index.md
}

export interface OnboardingContent {
  projectName: string
  projectDoc: string
  tasks: OnboardingTask[]
}

/** Stable task ids — deterministic so the seed is idempotent and the docs land at known paths. */
const ID_WELCOME = 'berth-guide-welcome'
const ID_IMPORT = 'berth-guide-import'
const ID_LAUNCH = 'berth-guide-launch'
const ID_ARCHIVE = 'berth-guide-archive'

const ZH: OnboardingContent = {
  projectName: '⚓ 试航：5 分钟认识 Berth',
  projectDoc: [
    '# ⚓ 试航：5 分钟认识 Berth — 项目上下文', '',
    '## 目标 / 为什么', '<!-- 稳定 -->',
    '这是 Berth 自带的新手引导项目。跟着下面的任务走一遍，5 分钟摸清 Berth 的主路径：会话停泊、从任务启动会话、用项目/任务组织工作。', '',
    '## 背景 / 约束 / 关键决策', '<!-- 稳定 -->',
    '- 这个项目是**样例**，里面的任务就是引导步骤，按 P0 → P3 的顺序做即可。',
    '- 全部走完后，最后一条任务会教你把整个项目归档。',
    '- 不想跟引导？直接归档本项目即可，不影响任何真实数据。', '',
    '## 当前状态', '<!-- 活跃：覆盖式更新为"现在进展到哪" -->',
    '等待新用户开始第一步「👋 从这里开始」。', '',
    '## 关键资料 / 入口', '<!-- 关键目录、文件、spec、链接 -->',
    '- 会话列表：集中查看 / 导入 / 启动会话。',
    '- 设置：选择启动会话用的 CLI 与默认模型。', '',
    '## 进展日志', '<!-- 追加型：- YYYY-MM-DD: … -->', '',
  ].join('\n') + '\n',
  tasks: [
    {
      id: ID_WELCOME, title: '👋 从这里开始：Berth 是什么', status: '进行中', priority: 'P0',
      doc: [
        '# 👋 从这里开始：Berth 是什么 — 任务上下文', '',
        '## 目标 / 验收标准', '<!-- 稳定：除非被要求否则不改 -->',
        '读完这条，你会知道 Berth 是做什么的，以及左边这几条引导任务怎么用。', '',
        '## 背景', '<!-- 稳定：所属项目 ⚓ 试航：5 分钟认识 Berth -->',
        'Berth 是你所有命令行 agent 会话（Claude Code / Codex / Coco）的「停泊港」：',
        '- **会话**：把散落在各个 CLI 里的会话集中到一处，随时回到任一会话的终端继续——会话进程在后台不断线。',
        '- **项目 / 任务**：像看板一样把工作组织成项目和任务（就是你现在看到的这些）。',
        '- **任务直接起会话**：在一条任务上点「启动」，Berth 会开一个带好上下文的 agent 会话替你干活。', '',
        '这条「试航」项目就是一份样例——跟着下面三条任务走一遍，你就摸清了主路径。完成后可以放心把整个项目归档（最后一条任务会教你）。', '',
        '## 计划 / TODO', '<!-- 活跃：- [ ] 复选框，完成后勾选 -->',
        '- [ ] 看懂这条说明',
        '- [ ] 去做「📥 导入一个已有会话」',
        '- [ ] 去做「🚀 从任务启动一个会话」',
        '- [ ] 最后「✅ 归档这个引导项目」', '',
        '## 决策 / 风险', '<!-- 活跃 -->', '',
        '## 进展日志', '<!-- 追加型：- YYYY-MM-DD: … -->', '',
      ].join('\n') + '\n',
    },
    {
      id: ID_IMPORT, title: '📥 导入一个已有的 Claude / Codex 会话', status: '待办', priority: 'P1',
      doc: [
        '# 📥 导入一个已有的 Claude / Codex 会话 — 任务上下文', '',
        '## 目标 / 验收标准', '<!-- 稳定：除非被要求否则不改 -->',
        '在左侧会话列表里看到至少一个你自己机器上已有的 CLI 会话。', '',
        '## 背景', '<!-- 稳定：所属项目 ⚓ 试航：5 分钟认识 Berth -->',
        '你装 Berth 之前，机器上可能已经跑过不少 Claude Code / Codex / Coco 会话。Berth 默认**只读**这些会话存储，不会自动把它们全铺在列表里——由你来挑要关注哪些。', '',
        '## 计划 / TODO', '<!-- 活跃：- [ ] 复选框，完成后勾选 -->',
        '- [ ] 打开会话列表页的「导入」对话框',
        '- [ ] 勾选一个你认得的会话，导入',
        '- [ ] 它出现在列表后，点开看终端回放——会话进程没断，可以直接继续', '',
        '## 决策 / 风险', '<!-- 活跃 -->',
        '- 如果机器上还没有任何 CLI 会话，这步可以跳过，直接去做「🚀 从任务启动一个会话」——那条会**新建**一个会话，不依赖已有数据。', '',
        '## 进展日志', '<!-- 追加型：- YYYY-MM-DD: … -->', '',
      ].join('\n') + '\n',
    },
    {
      id: ID_LAUNCH, title: '🚀 从这个任务直接启动一个 agent 会话', status: '待办', priority: 'P1',
      doc: [
        '# 🚀 从这个任务直接启动一个 agent 会话 — 任务上下文', '',
        '## 目标 / 验收标准', '<!-- 稳定：除非被要求否则不改 -->',
        '在这条任务上点「启动」，看着一个 agent 会话被拉起、自动收到这条任务、并开口回应——亲眼确认「任务 → 会话」链路打通了。', '',
        '## 背景', '<!-- 稳定：所属项目 ⚓ 试航：5 分钟认识 Berth -->',
        '这是 Berth 最独特的能力：你不用自己开终端、敲命令、再把上下文复制进去。点一下「启动」，Berth 会：',
        '1. 起一个新的 agent 会话（用你在设置里选的 CLI / 模型）；',
        '2. 把这条任务作为第一条指令**自动提交**；',
        '3. 通过静默通道把这份上下文文档喂给 agent。', '',
        '### 给被启动的 agent 的指令',
        '> 你是被 Berth 从一条引导任务里启动的。请做两件事，向用户证明「任务 → 会话 · 自动提交上下文」链路成功了：',
        '> 1. 用一两句话做个自我介绍（你是哪个 CLI / 模型）。',
        '> 2. 复述你收到的这条任务标题，并说明你是从 Berth 注入的上下文里读到它的。',
        '>',
        '> 然后停下来等用户，不要自行展开其它工作。', '',
        '## 计划 / TODO', '<!-- 活跃：- [ ] 复选框，完成后勾选 -->',
        '- [ ] 点这条任务的「启动」',
        '- [ ] 看 agent 自我介绍并复述任务标题',
        '- [ ] 回到任务列表，确认这个会话已和本任务关联', '',
        '## 决策 / 风险', '<!-- 活跃 -->',
        '- 启动需要本机已安装并登录至少一个 CLI（claude / codex / coco）。若弹出「请先登录」之类提示，按提示在终端跑一次 `claude login`（或 `codex login`）即可。', '',
        '## 进展日志', '<!-- 追加型：- YYYY-MM-DD: … -->', '',
      ].join('\n') + '\n',
    },
    {
      id: ID_ARCHIVE, title: '✅ 完成试航：归档这个引导项目', status: '待办', priority: 'P3',
      doc: [
        '# ✅ 完成试航：归档这个引导项目 — 任务上下文', '',
        '## 目标 / 验收标准', '<!-- 稳定：除非被要求否则不改 -->',
        '把「试航」项目归档，让侧栏回到只剩你自己的真实项目。', '',
        '## 背景', '<!-- 稳定：所属项目 ⚓ 试航：5 分钟认识 Berth -->',
        '你已经走完了 Berth 的主路径：导入会话、从任务启动会话、用任务和上下文文档组织工作。这份引导项目的使命完成了。', '',
        '归档不会删数据——项目会从活跃列表收起，需要时还能找回。这也顺带演示了 Berth 的项目归档能力。', '',
        '## 计划 / TODO', '<!-- 活跃：- [ ] 复选框，完成后勾选 -->',
        '- [ ] 打开本项目的工作区',
        '- [ ] 归档「⚓ 试航：5 分钟认识 Berth」',
        '- [ ] 开始用 Berth 管理你真正的工作 🎉', '',
        '## 决策 / 风险', '<!-- 活跃 -->', '',
        '## 进展日志', '<!-- 追加型：- YYYY-MM-DD: … -->', '',
      ].join('\n') + '\n',
    },
  ],
}

const EN: OnboardingContent = {
  projectName: '⚓ Shakedown: meet Berth in 5 minutes',
  projectDoc: [
    '# ⚓ Shakedown: meet Berth in 5 minutes — Project context', '',
    '## Goal / Why', '<!-- stable -->',
    "Berth's built-in getting-started project. Walk through the tasks below and you'll have the main path down in 5 minutes: dock your sessions, launch a session from a task, organize work with projects/tasks.", '',
    '## Background / Constraints / Decisions', '<!-- stable -->',
    '- This project is a **sample** — its tasks ARE the onboarding steps; do them in P0 → P3 order.',
    '- The last task teaches you how to archive the whole project once done.',
    "- Don't want the tour? Just archive this project — it touches none of your real data.", '',
    '## Current status', '<!-- active: overwrite with "where it stands now" -->',
    'Waiting for the new user to start step one, "👋 Start here".', '',
    '## Key references / Entry points', '<!-- key dirs, files, specs, links -->',
    '- Sessions list: view / import / launch sessions in one place.',
    '- Settings: pick the CLI and default model used to launch sessions.', '',
    '## Progress log', '<!-- append-only: - YYYY-MM-DD: … -->', '',
  ].join('\n') + '\n',
  tasks: [
    {
      id: ID_WELCOME, title: '👋 Start here: what is Berth', status: '进行中', priority: 'P0',
      doc: [
        '# 👋 Start here: what is Berth — Task context', '',
        '## Goal / Acceptance', '<!-- stable: do not change unless asked -->',
        "After reading this you'll know what Berth does and how to use the guide tasks on the left.", '',
        '## Background', '<!-- stable: belongs to project ⚓ Shakedown: meet Berth in 5 minutes -->',
        'Berth is a home port for all your command-line agent sessions (Claude Code / Codex / Coco):',
        '- **Sessions**: gather sessions scattered across each CLI into one place; jump back into any session\'s terminal anytime — the process keeps running in the background.',
        '- **Projects / Tasks**: organize work into projects and tasks, kanban-style (what you see here).',
        '- **Launch a session from a task**: hit "Launch" on a task and Berth opens an agent session, pre-loaded with context, to do the work.', '',
        'This "Shakedown" project is a sample — walk the three tasks below and you\'ll have the main path down. When done you can safely archive the whole project (the last task shows you how).', '',
        '## Plan / TODO', '<!-- active: - [ ] checkboxes, tick when done -->',
        '- [ ] Understand this overview',
        '- [ ] Do "📥 Import an existing session"',
        '- [ ] Do "🚀 Launch a session from a task"',
        '- [ ] Finally "✅ Archive this guide"', '',
        '## Decisions / Risks', '<!-- active -->', '',
        '## Progress log', '<!-- append-only: - YYYY-MM-DD: … -->', '',
      ].join('\n') + '\n',
    },
    {
      id: ID_IMPORT, title: '📥 Import an existing Claude / Codex session', status: '待办', priority: 'P1',
      doc: [
        '# 📥 Import an existing Claude / Codex session — Task context', '',
        '## Goal / Acceptance', '<!-- stable: do not change unless asked -->',
        'See at least one of your own existing CLI sessions show up in the sessions list on the left.', '',
        '## Background', '<!-- stable: belongs to project ⚓ Shakedown: meet Berth in 5 minutes -->',
        'Before installing Berth you may have already run plenty of Claude Code / Codex / Coco sessions. Berth reads those session stores **read-only** and does NOT dump them all into the list — you pick which ones to track.', '',
        '## Plan / TODO', '<!-- active: - [ ] checkboxes, tick when done -->',
        '- [ ] Open the "Import" dialog on the sessions page',
        '- [ ] Check one session you recognize and import it',
        '- [ ] Once it appears, open it to see the terminal replay — the process never stopped, so you can carry on', '',
        '## Decisions / Risks', '<!-- active -->',
        '- No CLI sessions on this machine yet? Skip this step and go straight to "🚀 Launch a session from a task" — that one **creates** a fresh session and needs no existing data.', '',
        '## Progress log', '<!-- append-only: - YYYY-MM-DD: … -->', '',
      ].join('\n') + '\n',
    },
    {
      id: ID_LAUNCH, title: '🚀 Launch an agent session straight from this task', status: '待办', priority: 'P1',
      doc: [
        '# 🚀 Launch an agent session straight from this task — Task context', '',
        '## Goal / Acceptance', '<!-- stable: do not change unless asked -->',
        'Hit "Launch" on this task and watch an agent session spin up, receive this task automatically, and reply — seeing the task → session chain work with your own eyes.', '',
        '## Background', '<!-- stable: belongs to project ⚓ Shakedown: meet Berth in 5 minutes -->',
        "This is Berth's most distinctive capability: no opening a terminal, typing commands, and pasting context yourself. One click on \"Launch\" and Berth will:",
        '1. Spin up a new agent session (with the CLI / model you picked in Settings);',
        '2. **Auto-submit** this task as the first instruction;',
        '3. Feed this context document to the agent over a silent channel.', '',
        '### Directive for the launched agent',
        '> You were launched by Berth from an onboarding task. Do two things to prove the "task → session, auto-injected context" chain worked:',
        '> 1. Introduce yourself in a sentence or two (which CLI / model you are).',
        '> 2. Repeat the title of the task you received, and note that you read it from the context Berth injected.',
        '>',
        '> Then stop and wait for the user — do not go off and do other work.', '',
        '## Plan / TODO', '<!-- active: - [ ] checkboxes, tick when done -->',
        '- [ ] Click "Launch" on this task',
        '- [ ] Watch the agent introduce itself and repeat the task title',
        '- [ ] Return to the task list and confirm the session is now linked to this task', '',
        '## Decisions / Risks', '<!-- active -->',
        '- Launching needs at least one CLI (claude / codex / coco) installed and logged in on this machine. If you see a "please log in" prompt, run `claude login` (or `codex login`) once in a terminal as instructed.', '',
        '## Progress log', '<!-- append-only: - YYYY-MM-DD: … -->', '',
      ].join('\n') + '\n',
    },
    {
      id: ID_ARCHIVE, title: '✅ Finish the shakedown: archive this guide', status: '待办', priority: 'P3',
      doc: [
        '# ✅ Finish the shakedown: archive this guide — Task context', '',
        '## Goal / Acceptance', '<!-- stable: do not change unless asked -->',
        'Archive the "Shakedown" project so the sidebar is left with just your own real projects.', '',
        '## Background', '<!-- stable: belongs to project ⚓ Shakedown: meet Berth in 5 minutes -->',
        "You've walked Berth's main path: import sessions, launch a session from a task, organize work with tasks and context docs. This guide project has done its job.", '',
        'Archiving does not delete anything — the project just folds out of the active list and can be brought back when needed. It also demonstrates Berth\'s project-archive capability.', '',
        '## Plan / TODO', '<!-- active: - [ ] checkboxes, tick when done -->',
        '- [ ] Open this project\'s workspace',
        '- [ ] Archive "⚓ Shakedown: meet Berth in 5 minutes"',
        '- [ ] Start using Berth for your real work 🎉', '',
        '## Decisions / Risks', '<!-- active -->', '',
        '## Progress log', '<!-- append-only: - YYYY-MM-DD: … -->', '',
      ].join('\n') + '\n',
    },
  ],
}

/** The onboarding project + task content for a locale. Status/priority are canonical, not localized. */
export function onboardingContent(locale: Locale): OnboardingContent {
  return locale === 'en' ? EN : ZH
}

/** Pick a status that actually exists in the configured vocab, else the configured default. */
function validStatus(statuses: string[], defaultStatus: string, preferred: string): string {
  return statuses.includes(preferred) ? preferred : defaultStatus
}

/**
 * Seed the first-run onboarding project + tasks + their context docs. Idempotent (guarded by the
 * `onboarding-seeded` flag). Returns true if it actually seeded, false if it was already seeded.
 * Best-effort doc writes: a task is still created even if its doc fails to write.
 */
export function seedOnboarding(store: Store, docStore: DocStore, locale: Locale, now: Now = Date.now): boolean {
  if (store.getSetting('onboarding-seeded')) return false
  const content = onboardingContent(locale)
  const cfg = getTaskFieldConfig(store)
  const project = store.upsertProject({ name: content.projectName })

  const projectAbs = docStore.resolveDocPath(docStore.projectDocRef(content.projectName))
  if (projectAbs) { try { docStore.writeDoc(projectAbs, content.projectDoc) } catch { /* best-effort */ } }

  const t = now()
  for (const task of content.tasks) {
    const ref = docStore.taskDocRef(task.id)
    const abs = docStore.resolveDocPath(ref)
    let detailDoc: string | null = null
    if (abs) { try { docStore.writeDoc(abs, task.doc); detailDoc = ref } catch { /* best-effort */ } }
    const row: Task = {
      id: task.id, title: task.title,
      status: validStatus(cfg.statuses, cfg.defaultStatus, task.status),
      priority: cfg.priorities.includes(task.priority) ? task.priority : cfg.defaultPriority,
      projectId: project.id ?? null, project: content.projectName,
      detailDoc, progress: null, updatedAt: t, syncedAt: 0, deleted: false,
    }
    store.insertTask(row)
  }

  store.setSetting('onboarding-seeded', '1')
  return true
}
