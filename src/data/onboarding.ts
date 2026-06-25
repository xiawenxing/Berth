// Onboarding seed: a sample "guide" project whose tasks ARE the onboarding steps. Seeded once for
// anyone who has not been SHOWN it yet (the caller gates on the `onboarding-seeded` flag, set the
// moment it seeds), so once a user has seen the guide it never returns — not even if they delete it.
//
// Scope/framing (decided with the owner): Berth manages PROJECTS, not sessions — the task is the
// goal, a session is just one disposable voyage. The 4 steps: understand (philosophy + 3-step setup)
// → one-click launch (genuinely launchable: its detail doc carries an explicit directive so the
// launched agent demonstrates the task→session auto-submit chain) → context & session import →
// archive. Ordered P0→P3 so they read top-to-bottom on the board.
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
    '这是 Berth 自带的新手引导项目。跟着下面四条任务走一遍，5 分钟摸清 Berth 的核心理念与主循环：用项目和任务组织工作，会话只是完成任务的一次航行。', '',
    '## 背景 / 约束 / 关键决策', '<!-- 稳定 -->',
    '- Berth 管的是**项目**，不是会话；**任务是最终目的**，**会话只是一次航行**（装上下文出航、带回交付物，用完即弃）。',
    '- 这个项目是**样例**，里面的任务就是引导步骤，按 P0 → P3 的顺序做即可。',
    '- 全部走完后，最后一条任务会教你把整个项目归档。不想跟引导？直接归档本项目即可，不影响任何真实数据。', '',
    '## 当前状态', '<!-- 活跃：覆盖式更新为"现在进展到哪" -->',
    '等待新用户开始第一步「👋 什么是 Berth」。', '',
    '## 关键资料 / 入口', '<!-- 关键目录、文件、spec、链接 -->',
    '- 会话列表：集中查看 / 导入 / 启航会话。',
    '- 设置：选择启航会话用的 CLI 与默认模型。', '',
    '## 进展日志', '<!-- 追加型：- YYYY-MM-DD: … -->', '',
  ].join('\n') + '\n',
  tasks: [
    {
      id: ID_WELCOME, title: '👋 什么是 Berth', status: '进行中', priority: 'P0',
      doc: [
        '# 👋 什么是 Berth — 任务上下文', '',
        '## 目标 / 验收标准', '<!-- 稳定：除非被要求否则不改 -->',
        '读完这条，你会理解 Berth 的核心理念，以及怎么三步初始化、把主循环跑起来。', '',
        '## 背景', '<!-- 稳定：所属项目 ⚓ 试航：5 分钟认识 Berth -->',
        'Berth 管的是**项目**，不是会话：',
        '- **任务是最终目的**——你真正要交付的东西。',
        '- **会话只是一次航行**：装上上下文出航、带回交付物，任务完成后即可弃用（**用完即弃**）。所以你不必珍藏会话——沉淀下来的项目、任务和上下文才是资产。', '',
        '### 三步初始化（把主循环跑通）',
        '1. **安装 skill**：在终端跑 `berth skill install`，把 berth-tasks skill 装进你的各个 agent——这样会话里的 agent 能直接用 `berth task` / `berth project` 读写你的任务和项目。',
        '2. **创建一个 Berth 项目**：项目是一切的容器，任务、目录、会话都挂在它下面。',
        '3. **新建一个任务并启航会话**：在项目下建任务，从任务点「启航」开一个 agent 会话替你干活——下一条「🚀 一键启航」就让你亲手试一次。', '',
        '## 计划 / TODO', '<!-- 活跃：- [ ] 复选框，完成后勾选 -->',
        '- [ ] 理解「项目为主、会话用完即弃」的理念',
        '- [ ] 跑一次 `berth skill install`',
        '- [ ] 建一个属于你自己的项目',
        '- [ ] 去做「🚀 一键启航」亲手起一个会话', '',
        '## 决策 / 风险', '<!-- 活跃 -->', '',
        '## 进展日志', '<!-- 追加型：- YYYY-MM-DD: … -->', '',
      ].join('\n') + '\n',
    },
    {
      id: ID_LAUNCH, title: '🚀 一键启航：点这条任务直接起会话', status: '待办', priority: 'P1',
      doc: [
        '# 🚀 一键启航：点这条任务直接起会话 — 任务上下文', '',
        '## 目标 / 验收标准', '<!-- 稳定：除非被要求否则不改 -->',
        '在这条任务上点「启航」，看着一个 agent 会话被拉起、自动收到这条任务、并开口回应——亲眼确认「任务 → 会话」链路打通了。', '',
        '## 背景', '<!-- 稳定：所属项目 ⚓ 试航：5 分钟认识 Berth -->',
        '这是 Berth 把「任务是目的、会话是一次航行」落到实处的地方：你不用自己开终端、敲命令、再把上下文复制进去。点一下「启航」，Berth 会：',
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
        '- [ ] 点这条任务的「启航」',
        '- [ ] 看 agent 自我介绍并复述任务标题',
        '- [ ] 回到任务列表，确认这个会话已和本任务关联', '',
        '## 决策 / 风险', '<!-- 活跃 -->',
        '- 启航需要本机已安装并登录至少一个 CLI（claude / codex / coco）。若弹出「请先登录」之类提示，按提示在终端跑一次 `claude login`（或 `codex login`）即可。', '',
        '## 进展日志', '<!-- 追加型：- YYYY-MM-DD: … -->', '',
      ].join('\n') + '\n',
    },
    {
      id: ID_IMPORT, title: '🧭 上下文与会话导入', status: '待办', priority: 'P2',
      doc: [
        '# 🧭 上下文与会话导入 — 任务上下文', '',
        '## 目标 / 验收标准', '<!-- 稳定：除非被要求否则不改 -->',
        '搞懂 Berth 的三层上下文，并把你机器上已有的一个会话导入进来、归到某个项目下。', '',
        '## 背景', '<!-- 稳定：所属项目 ⚓ 试航：5 分钟认识 Berth -->',
        '### 三层上下文',
        '- **项目上下文** `projects/<名字>/index.md`：项目级的目标 / 背景 / 现状，整个项目共享。',
        '- **任务上下文** `tasks/<id>/index.md`：单个任务的目标 / 计划 / 进展（你正在读的就是一份）。',
        '- **目录上下文 / 启动目录**：在项目里登记一个目录后，该项目的会话默认以这个目录**启航**（自动 `cd` 进去），agent 一开场就站在你的代码库里，不用每次手动指定路径。',
        '  - 举例：项目「我的博客」里导入目录 `~/code/my-blog` 设为启动目录；之后在这个项目新建任务、点启航，会话会自动 `cd` 到 `~/code/my-blog`。换到项目「公司官网」导入 `~/work/site`，它的会话就默认在那儿起航。一个项目可登记多个目录（货舱），启航时挑一个作主上下文。', '',
        '### 导入已有会话的三种方式',
        '1. **从已登记目录导入**：项目里登记过目录后，会话列表里可直接把该目录下的会话导入进来。',
        '2. **导入其他目录**：在某个会话后选「导入其他目录」，把那个目录下的会话导进来——但该目录**不会**成为项目的登记目录（一次性导入）。',
        '3. **从「无归属」按来源导入**：在「无归属」页面按 claude / codex / sessionId 把会话捞出来，导入后再归属到某个项目即可。', '',
        '## 计划 / TODO', '<!-- 活跃：- [ ] 复选框，完成后勾选 -->',
        '- [ ] 看懂项目 / 任务 / 目录三层上下文',
        '- [ ] 用任意一种方式导入一个已有会话',
        '- [ ] 把它归属到一个项目', '',
        '## 决策 / 风险', '<!-- 活跃 -->',
        '- 机器上还没有任何 CLI 会话？这条的「导入」可跳过，理解上下文概念即可。', '',
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
        '你已经走完了 Berth 的主循环：理解理念、从任务启航会话、用三层上下文与会话导入组织工作。这份引导项目的使命完成了。', '',
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
    "Berth's built-in getting-started project. Walk through the four tasks below and you'll grasp Berth's core idea and main loop in 5 minutes: organize work with projects and tasks; a session is just one voyage to get a task done.", '',
    '## Background / Constraints / Decisions', '<!-- stable -->',
    '- Berth manages **projects**, not sessions; **the task is the goal**, **a session is just one voyage** (sail out with context, bring back the deliverable, discard when done).',
    '- This project is a **sample** — its tasks ARE the onboarding steps; do them in P0 → P3 order.',
    "- The last task teaches you how to archive the whole project. Don't want the tour? Just archive this project — it touches none of your real data.", '',
    '## Current status', '<!-- active: overwrite with "where it stands now" -->',
    'Waiting for the new user to start step one, "👋 What is Berth".', '',
    '## Key references / Entry points', '<!-- key dirs, files, specs, links -->',
    '- Sessions list: view / import / launch sessions in one place.',
    '- Settings: pick the CLI and default model used to launch sessions.', '',
    '## Progress log', '<!-- append-only: - YYYY-MM-DD: … -->', '',
  ].join('\n') + '\n',
  tasks: [
    {
      id: ID_WELCOME, title: '👋 What is Berth', status: '进行中', priority: 'P0',
      doc: [
        '# 👋 What is Berth — Task context', '',
        '## Goal / Acceptance', '<!-- stable: do not change unless asked -->',
        "After reading this you'll understand Berth's core idea, and how to initialize in three steps and run the main loop.", '',
        '## Background', '<!-- stable: belongs to project ⚓ Shakedown: meet Berth in 5 minutes -->',
        'Berth manages **projects**, not sessions:',
        '- **The task is the goal** — the thing you actually want to deliver.',
        '- **A session is just one voyage**: sail out loaded with context, bring back the deliverable, and discard it once the task is done (**use it and toss it**). So you never hoard sessions — the projects, tasks, and context that accumulate are the real assets.', '',
        '### Three-step setup (run the main loop)',
        '1. **Install the skill**: run `berth skill install` in a terminal to install the berth-tasks skill into your agents — so an agent inside a session can drive your tasks/projects with `berth task` / `berth project` directly.',
        '2. **Create a Berth project**: a project is the container for everything — tasks, directories, and sessions all hang under it.',
        '3. **Create a task and launch a session**: add a task under the project and hit "Launch" to spin up an agent session to do the work — the next task, "🚀 One-click launch", lets you try it hands-on.', '',
        '## Plan / TODO', '<!-- active: - [ ] checkboxes, tick when done -->',
        '- [ ] Grasp the "projects first, sessions are disposable" idea',
        '- [ ] Run `berth skill install` once',
        '- [ ] Create a project of your own',
        '- [ ] Do "🚀 One-click launch" to start a session hands-on', '',
        '## Decisions / Risks', '<!-- active -->', '',
        '## Progress log', '<!-- append-only: - YYYY-MM-DD: … -->', '',
      ].join('\n') + '\n',
    },
    {
      id: ID_LAUNCH, title: '🚀 One-click launch: start a session from this task', status: '待办', priority: 'P1',
      doc: [
        '# 🚀 One-click launch: start a session from this task — Task context', '',
        '## Goal / Acceptance', '<!-- stable: do not change unless asked -->',
        'Hit "Launch" on this task and watch an agent session spin up, receive this task automatically, and reply — seeing the task → session chain work with your own eyes.', '',
        '## Background', '<!-- stable: belongs to project ⚓ Shakedown: meet Berth in 5 minutes -->',
        'This is where Berth makes "the task is the goal, the session is just a voyage" concrete: no opening a terminal, typing commands, and pasting context yourself. One click on "Launch" and Berth will:',
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
      id: ID_IMPORT, title: '🧭 Context & importing sessions', status: '待办', priority: 'P2',
      doc: [
        '# 🧭 Context & importing sessions — Task context', '',
        '## Goal / Acceptance', '<!-- stable: do not change unless asked -->',
        "Understand Berth's three layers of context, then import one of your machine's existing sessions and assign it to a project.", '',
        '## Background', '<!-- stable: belongs to project ⚓ Shakedown: meet Berth in 5 minutes -->',
        '### Three layers of context',
        '- **Project context** `projects/<name>/index.md`: project-level goal / background / status, shared across the whole project.',
        '- **Task context** `tasks/<id>/index.md`: a single task\'s goal / plan / progress (the one you are reading is exactly this).',
        '- **Directory context / launch directory**: register a directory in a project and that project\'s sessions **launch** in it by default (auto `cd` into it), so the agent starts out standing in your codebase — no need to specify the path every time.',
        '  - Example: in project "My Blog" import the directory `~/code/my-blog` as the launch directory; then create a task in that project and launch — the session auto-`cd`s into `~/code/my-blog`. Switch to project "Company Site" with `~/work/site` and its sessions launch there instead. A project can register multiple directories (cargo); pick one as the primary context at launch.', '',
        '### Three ways to import an existing session',
        '1. **From a registered directory**: once a project has a registered directory, the sessions list lets you import the sessions under it directly.',
        '2. **Import another directory**: on a given session, choose "import another directory" to pull in sessions under it — but that directory does **not** become a registered directory of the project (a one-off import).',
        '3. **From "Unassigned" by source**: on the "Unassigned" page, fish out sessions by claude / codex / sessionId, then assign them to a project afterwards.', '',
        '## Plan / TODO', '<!-- active: - [ ] checkboxes, tick when done -->',
        '- [ ] Grasp the project / task / directory context layers',
        '- [ ] Import an existing session by any of the three methods',
        '- [ ] Assign it to a project', '',
        '## Decisions / Risks', '<!-- active -->',
        '- No CLI sessions on this machine yet? Skip the import here — just understanding the context concepts is enough.', '',
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
        "You've walked Berth's main loop: grasp the idea, launch a session from a task, organize work with the three context layers and session import. This guide project has done its job.", '',
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
