// Onboarding seed: a sample "guide" project whose tasks ARE the onboarding steps. Seeded once for
// anyone who has not been SHOWN it yet (the caller gates on the `onboarding-seeded` flag, set the
// moment it seeds), so once a user has seen the guide it never returns — not even if they delete it.
//
// Scope/framing (decided with the owner): Berth manages PROJECTS, not sessions — the task is the
// goal, a session is just one disposable voyage. The guide is a launch-to-learn FAQ: task 1 explains
// Berth, then a set of question-tasks each answer one thing when launched. The launched agent is told
// to DEMONSTRATE Berth by actually using it — task 1 really runs `berth install skill`, and every
// task marks itself complete with `berth task done` so the user watches the status flow to 已完成
// (that lifecycle is itself the feature demo). Tasks sort on the board by updated_at DESC, so the seed
// staggers updated_at by index to keep them in this top-to-bottom order.
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

/** Sort the guide project last (sort ASC) so it never steals an existing user's default landing. */
const GUIDE_SORT = 1_000_000

/** Stable task ids — deterministic so the seed is idempotent and the docs land at known paths. */
const ID_WELCOME = 'berth-guide-welcome'
const ID_IMPORT = 'berth-guide-import'
const ID_UNASSIGNED = 'berth-guide-unassigned'
const ID_VISIBILITY = 'berth-guide-visibility'
const ID_CARGO = 'berth-guide-cargo'
const ID_DEFAULT_LOAD = 'berth-guide-default-load'
const ID_REMOVE = 'berth-guide-remove'
const ID_CONTEXT = 'berth-guide-context'
const ID_MAINTAIN = 'berth-guide-maintain'
const ID_AGENT = 'berth-guide-agent'
const ID_ARCHIVE = 'berth-guide-archive'

const ZH_NAME = '⚓ 试航：5 分钟认识 Berth'
const EN_NAME = '⚓ Shakedown: meet Berth in 5 minutes'

// ── question-task builders ─────────────────────────────────────────────────
// Each question task: title = "❓ <question>", body = the full answer as 背景/Background reference,
// plus a directive telling the launched agent to answer it (and not touch berth/the task).

interface QSpec { id: string; priority: string; zh: { q: string; answer: string[] }; en: { q: string; answer: string[] } }

function questionDocZh(q: string, answer: string[]): string {
  return [
    `# ❓ ${q} — 任务上下文`, '',
    '## 目标 / 验收标准', '<!-- 稳定：除非被要求否则不改 -->',
    `点这条任务的「启航」，让 agent 用大白话回答「${q}」——也顺手再演示一次「从任务启航会话」。`, '',
    '## 背景', `<!-- 稳定：所属项目 ${ZH_NAME} -->`,
    ...answer, '',
    '### 给被启动的 agent 的指令',
    `> 你是被 Berth 从一条引导任务启动的。请基于上面「背景」里的内容，面向第一次用 Berth 的新人，用你自己的话把「${q}」讲清楚。`,
    '>',
    '> 回答完后，用 `berth task done` 把这条任务标记完成（已安装 berth-tasks skill 的话直接用它即可），让用户亲眼看到任务状态流转到「已完成」——这本身就是 Berth 的功能展示。然后停下等用户。', '',
    '## 计划 / TODO', '<!-- 活跃：- [ ] 复选框，完成后勾选 -->',
    '- [ ] 启航这条任务，听 agent 回答这个问题',
    '- [ ] 看 agent 把这条任务标记完成（状态流转演示）', '',
    '## 决策 / 风险', '<!-- 活跃 -->', '',
    '## 进展日志', '<!-- 追加型：- YYYY-MM-DD: … -->', '',
  ].join('\n') + '\n'
}

function questionDocEn(q: string, answer: string[]): string {
  return [
    `# ❓ ${q} — Task context`, '',
    '## Goal / Acceptance', '<!-- stable: do not change unless asked -->',
    `Hit "Launch" on this task and let the agent answer "${q}" in plain words — also another live demo of "launch a session from a task".`, '',
    '## Background', `<!-- stable: belongs to project ${EN_NAME} -->`,
    ...answer, '',
    '### Directive for the launched agent',
    `> You were launched by Berth from an onboarding task. Based on the "Background" above, explain "${q}" to a first-time Berth user in your own words.`,
    '>',
    '> When done, run `berth task done` to mark this task complete (or use the berth-tasks skill if installed), so the user watches the status flow to "done" — that lifecycle is itself a Berth feature demo. Then stop and wait for the user.', '',
    '## Plan / TODO', '<!-- active: - [ ] checkboxes, tick when done -->',
    '- [ ] Launch this task and hear the agent answer the question',
    '- [ ] Watch the agent mark the task complete (status-flow demo)', '',
    '## Decisions / Risks', '<!-- active -->', '',
    '## Progress log', '<!-- append-only: - YYYY-MM-DD: … -->', '',
  ].join('\n') + '\n'
}

const QUESTIONS: QSpec[] = [
  {
    id: ID_IMPORT, priority: 'P1',
    zh: { q: '如何导入已有会话？', answer: [
      'Berth 默认只读扫描你机器上的 Claude Code / Codex / Coco 会话，但不会自动全铺出来——三种方式把它们请进来：',
      '1. **从已登记目录导入**：项目里登记过货舱目录后，会话列表能直接把该目录下的会话导入进来。',
      '2. **导入其他目录**：在某个会话后选「导入其他目录」，一次性导入那个目录下的会话——该目录**不会**被登记为货舱。',
      '3. **从「无归属」按来源导入**：在「无归属」页面按 claude / codex / sessionId 把会话捞出来，导入后再归属到某个项目。',
    ] },
    en: { q: 'How do I import an existing session?', answer: [
      "Berth scans your machine's Claude Code / Codex / Coco sessions read-only but does not surface them all automatically — three ways to bring them in:",
      '1. **From a registered directory**: once a project has a registered cargo directory, the sessions list can import the sessions under it directly.',
      '2. **Import another directory**: on a session, choose "import another directory" for a one-off import of sessions under it — that directory is **not** registered as cargo.',
      '3. **From "Unassigned" by source**: on the "Unassigned" page, pull sessions in by claude / codex / sessionId, then assign them to a project.',
    ] },
  },
  {
    id: ID_UNASSIGNED, priority: 'P1',
    zh: { q: '什么是「无归属」会话？', answer: [
      '「无归属」是已被 Berth 识别 / 导入、但还没归到任何项目的会话的集中地。',
      '你可以在这里按来源（claude / codex / sessionId）导入会话、浏览它们，再把需要的归属到某个项目；不急着归的就先留在这儿。',
      '它相当于会话进入项目前的“中转区”。',
    ] },
    en: { q: 'What is the "Unassigned" bucket?', answer: [
      '"Unassigned" is where sessions Berth has recognized / imported but not yet placed under any project collect.',
      'Here you can import sessions by source (claude / codex / sessionId), browse them, and assign the ones you want to a project; the rest just stay here.',
      'Think of it as a staging area before a session joins a project.',
    ] },
  },
  {
    id: ID_VISIBILITY, priority: 'P1',
    zh: { q: '为什么有些会话没显示在列表里？', answer: [
      'Berth 对 CLI 会话存储是只读扫描，但默认不会把扫到的每个会话都铺到列表——只有进入“精选集”的才显示：',
      '你导入过的、置顶的、关联到任务或项目的，以及 Berth 启动并绑定的会话。',
      '关键点：**登记一个货舱目录并不会**让该目录下所有会话冒出来（会话粒度导入）。想看某个会话，去把它导入即可。',
    ] },
    en: { q: 'Why are some sessions not showing in the list?', answer: [
      'Berth scans CLI session stores read-only, but by default it does not surface every session it finds — only the "curated set" shows:',
      'sessions you imported, pinned, linked to a task or project, or that Berth launched and bound.',
      'Key point: **registering a cargo directory does NOT** surface every session under it (session-grained import). To see a session, import it.',
    ] },
  },
  {
    id: ID_CARGO, priority: 'P2',
    zh: { q: '装载区域的目录登记有什么用？', answer: [
      '在项目的“装载 / 货舱”区登记一个或多个代码目录，作用有三：',
      '1. **目录上下文 / 启动目录**：启航该项目的会话时默认 `cd` 进这个目录，agent 一开场就站在你的代码库里，不用每次手动指定路径。',
      '2. **从该目录导入会话**：会话列表可直接把这个已登记目录下的会话导入进来。',
      '3. **可登记多个**：一个项目可挂多个货舱，启航时挑一个作主上下文（见「默认装载」）。',
      '注意：登记目录本身不会把目录下所有会话一股脑铺出来。',
    ] },
    en: { q: 'What is registering a directory in the cargo area for?', answer: [
      'Register one or more code directories in a project\'s "cargo / loading" area. It does three things:',
      '1. **Directory context / launch directory**: sessions launched in this project auto-`cd` into it, so the agent starts out in your codebase — no specifying the path each time.',
      '2. **Import sessions from it**: the sessions list can import the sessions under this registered directory directly.',
      '3. **Multiple allowed**: a project can hold several cargo dirs; pick one as the primary context at launch (see "default load").',
      'Note: registering a directory does not dump all its sessions into the list.',
    ] },
  },
  {
    id: ID_DEFAULT_LOAD, priority: 'P2',
    zh: { q: '「默认装载」是什么意思？', answer: [
      '「默认装载」是货舱目录上的一个开关。',
      '打开的目录，会在启航会话时被默认带上，作为会话的工作目录 / 上下文；关掉则只是登记、不默认装载。',
      '一个项目可有多个货舱，用「默认装载」决定开场默认带哪个目录。若没有任何启用的货舱，启航会落到“项目默认目录”。',
    ] },
    en: { q: 'What does "default load" mean?', answer: [
      '"Default load" is a switch on a cargo directory.',
      'A directory that is on gets carried by default when you launch a session, as its working directory / context; off means registered-but-not-default-loaded.',
      'A project can have several cargo dirs; "default load" decides which one is carried by default. With none enabled, a launch falls back to the "project default directory".',
    ] },
  },
  {
    id: ID_REMOVE, priority: 'P2',
    zh: { q: '移除会话会真的删除本地会话吗？', answer: [
      '**不会。** Berth 对 ~/.claude、~/.codex、coco 的会话存储是**只读**的，从不写入或删除它们。',
      '「取消导入 / 移除」只是撤销 Berth 侧的可见与组织信号：把它从精选集移出、解除任务关联、取消置顶——磁盘上真实的会话文件原样保留。',
      '所以移除只是“从 Berth 视野里收起”，之后随时能重新导入。',
    ] },
    en: { q: 'Does removing a session actually delete the local session?', answer: [
      '**No.** Berth treats the ~/.claude, ~/.codex, and coco session stores as **read-only** — it never writes to or deletes them.',
      '"Unimport / remove" only revokes Berth-side visibility and organization signals: it drops the session from the curated set, clears task links, and unpins it — the real session file on disk is left untouched.',
      'So removing just tucks it out of Berth\'s view; you can re-import it anytime.',
    ] },
  },
  {
    id: ID_CONTEXT, priority: 'P2',
    zh: { q: '项目上下文和任务上下文有什么区别？', answer: [
      '两者都是 Berth 维护的 markdown 上下文文档，分工不同：',
      '- **项目上下文** `projects/<名字>/index.md`：项目级的目标 / 背景 / 当前状态 / 关键资料，整个项目共享。',
      '- **任务上下文** `tasks/<id>/index.md`：单个任务的目标 / 计划 / 决策 / 进展日志（你正在读的就是一份）。',
      '启航会话时，Berth 会按归属把对应的项目上下文 + 任务上下文一起喂给 agent，让它一开场就知道全局和当前这件事。',
    ] },
    en: { q: 'What is the difference between project context and task context?', answer: [
      'Both are markdown context docs Berth maintains, with a division of labor:',
      '- **Project context** `projects/<name>/index.md`: project-level goal / background / current status / key references, shared across the project.',
      '- **Task context** `tasks/<id>/index.md`: a single task\'s goal / plan / decisions / progress log (the one you are reading).',
      'At launch, Berth feeds the matching project context + task context to the agent, so it starts knowing both the big picture and this specific thing.',
    ] },
  },
  {
    id: ID_MAINTAIN, priority: 'P3',
    zh: { q: '进展日志 / 上下文文档会自动维护吗？', answer: [
      '半自动——人（agent）写，Berth 帮你滚动和兜底：',
      '- **维护规则**写在「上下文维护协议」(`AGENTS.md`)：agent 推进时更新计划 / 决策段，收尾向「进展日志」追加一行 `- 日期: 摘要`。',
      '- **自动滚动**：进展日志过长时 Berth 会机械地把旧条目滚动归档到 `progress-archive.md`；会话退出也会触发一次。',
      '- **⟳ 刷新上下文**：点会话行的 ⟳，让无头 agent 读这次会话的 transcript，把进展整合回上下文文档。',
      '注意：状态 / 优先级是 Berth 数据库的真源，不写进文档。',
    ] },
    en: { q: 'Are the progress log and context docs maintained automatically?', answer: [
      'Semi-automatic — the agent writes, Berth rolls and backstops:',
      '- **Maintenance rules** live in the context protocol (`AGENTS.md`): the agent updates the plan / decisions sections as it works and appends one `- date: summary` line to the progress log at the end.',
      '- **Auto-roll**: when the progress log grows, Berth mechanically rolls older entries into `progress-archive.md`; a session exit also triggers a roll.',
      '- **⟳ Refresh context**: click ⟳ on a session row to have a headless agent read that session\'s transcript and fold the progress back into the context doc.',
      "- Note: status / priority are owned by Berth's database, not the doc.",
    ] },
  },
  {
    id: ID_AGENT, priority: 'P3',
    zh: { q: '启航用哪个 CLI / 模型？怎么改？', answer: [
      '在「设置」里配：',
      '- 每个 CLI（claude / codex / coco）可单独**启用 / 停用**，并各设一个**默认模型**（coco 没有 --model）。',
      '- 另有一个「berth 管理 agent」——用于生成任务标题、进展小结等无头任务，可单独选 CLI + 模型。',
      '- 每次启航时，启航对话框里也能临时选这次用哪个 CLI 和哪个目录。',
    ] },
    en: { q: 'Which CLI / model does a launch use, and how do I change it?', answer: [
      'Configure it in Settings:',
      '- Each CLI (claude / codex / coco) can be **enabled / disabled** individually, each with a **default model** (coco has no --model).',
      '- There is also a "berth management agent" — used for headless jobs like generating task titles and progress summaries — with its own CLI + model.',
      '- At each launch, the launch dialog also lets you pick which CLI and which directory to use this time.',
    ] },
  },
]

function welcomeTask(locale: Locale): OnboardingTask {
  const zh = locale !== 'en'
  return {
    id: ID_WELCOME, status: '进行中', priority: 'P0',
    title: zh ? '👋 告诉我什么是 Berth' : '👋 Tell me what Berth is',
    doc: zh
      ? [
          '# 👋 告诉我什么是 Berth — 任务上下文', '',
          '## 目标 / 验收标准', '<!-- 稳定：除非被要求否则不改 -->',
          '点这条任务的「启航」，让 agent 用大白话给你讲清楚「什么是 Berth」——这既是 onboarding 的第一课，也顺手演示了「从任务启航会话」。', '',
          '## 背景', `<!-- 稳定：所属项目 ${ZH_NAME} -->`,
          'Berth 管的是**项目**，不是会话：',
          '- **任务是最终目的**——你真正要交付的东西。',
          '- **会话只是一次航行**：装上上下文出航、带回交付物，任务完成后即可弃用（**用完即弃**）。所以你不必珍藏会话——沉淀下来的项目、任务和上下文才是资产。', '',
          '三步初始化（把主循环跑通）：①在终端跑 `berth install skill` 把 berth-tasks skill 装进各个 agent；②创建一个 Berth 项目（一切的容器）；③在项目下新建任务并从任务「启航」一个会话。', '',
          '### 给被启动的 agent 的指令',
          '> 你是被 Berth 从一条引导任务里启动的。请做三件事，既讲清 Berth 也顺手演示它：',
          '> 1. 用你自己的话、面向第一次用 Berth 的新人，讲清「什么是 Berth」：核心理念（管项目不管会话、任务是目的、会话用完即弃）+ 三步初始化。',
          '> 2. **实际执行初始化第一步**：在终端运行 `berth install skill`，把 berth-tasks skill 装好（装好后，以后会话里的 agent 就能直接用 `berth task` / `berth project`）。若 `berth` 命令不存在，就提示用户先安装 Berth 的 CLI。',
          '> 3. 收尾时用 `berth task done` 把这条任务标记完成，让用户看到状态从「进行中」变「已完成」——这本身就是 Berth 的功能展示。',
          '>',
          '> 做完就停下等用户，不要自行展开其它无关工作。', '',
          '## 计划 / TODO', '<!-- 活跃：- [ ] 复选框，完成后勾选 -->',
          '- [ ] 点这条任务的「启航」，看 agent 讲 Berth、装好 skill、并把任务标记完成',
          '- [ ] 理解「项目为主、会话用完即弃」的理念',
          '- [ ] 建一个属于你自己的项目',
          '- [ ] 往下走，启航后面几条「❓问题」任务，让 agent 一条条答给你听', '',
          '## 决策 / 风险', '<!-- 活跃 -->', '',
          '## 进展日志', '<!-- 追加型：- YYYY-MM-DD: … -->', '',
        ].join('\n') + '\n'
      : [
          '# 👋 Tell me what Berth is — Task context', '',
          '## Goal / Acceptance', '<!-- stable: do not change unless asked -->',
          'Hit "Launch" on this task and let the agent explain "what is Berth" in plain words — your first onboarding lesson, and a live demo of "launch a session from a task".', '',
          '## Background', `<!-- stable: belongs to project ${EN_NAME} -->`,
          'Berth manages **projects**, not sessions:',
          '- **The task is the goal** — the thing you actually want to deliver.',
          '- **A session is just one voyage**: sail out loaded with context, bring back the deliverable, and discard it once the task is done (**use it and toss it**). So you never hoard sessions — the projects, tasks, and context that accumulate are the real assets.', '',
          'Three-step setup (run the main loop): (1) run `berth install skill` in a terminal to install the berth-tasks skill into your agents; (2) create a Berth project (the container for everything); (3) create a task under it and "Launch" a session from the task.', '',
          '### Directive for the launched agent',
          '> You were launched by Berth from an onboarding task. Do three things — explain Berth and demonstrate it:',
          '> 1. In your own words, to a first-time Berth user, explain "what is Berth": the core idea (manages projects not sessions, the task is the goal, a session is disposable) plus the three-step setup.',
          '> 2. **Actually run the first setup step**: run `berth install skill` in the terminal to install the berth-tasks skill (after that, agents in your sessions can use `berth task` / `berth project` directly). If the `berth` command is not found, tell the user to install the Berth CLI first.',
          '> 3. Finish by running `berth task done` to mark this task complete, so the user sees the status go from "in progress" to "done" — that itself shows off Berth.',
          '>',
          '> Then stop and wait for the user; do not go off and do unrelated work.', '',
          '## Plan / TODO', '<!-- active: - [ ] checkboxes, tick when done -->',
          '- [ ] Click "Launch" and watch the agent explain Berth, install the skill, and complete the task',
          '- [ ] Grasp the "projects first, sessions are disposable" idea',
          '- [ ] Create a project of your own',
          '- [ ] Move on and launch the "❓ question" tasks below to hear the agent answer them one by one', '',
          '## Decisions / Risks', '<!-- active -->', '',
          '## Progress log', '<!-- append-only: - YYYY-MM-DD: … -->', '',
        ].join('\n') + '\n',
  }
}

function archiveTask(locale: Locale): OnboardingTask {
  const zh = locale !== 'en'
  return {
    id: ID_ARCHIVE, status: '待办', priority: 'P3',
    title: zh ? '✅ 完成试航：归档这个引导项目' : '✅ Finish the shakedown: archive this guide',
    doc: zh
      ? [
          '# ✅ 完成试航：归档这个引导项目 — 任务上下文', '',
          '## 目标 / 验收标准', '<!-- 稳定：除非被要求否则不改 -->',
          '把「试航」项目归档，让侧栏回到只剩你自己的真实项目。', '',
          '## 背景', `<!-- 稳定：所属项目 ${ZH_NAME} -->`,
          '你已经走完了 Berth 的主循环：理解理念、从任务启航会话、并把会话导入 / 上下文 / 装载这些常见问题都问了一遍。这份引导项目的使命完成了。', '',
          '归档不会删数据——项目会从活跃列表收起，需要时还能找回。这也顺带演示了 Berth 的项目归档能力。', '',
          '## 计划 / TODO', '<!-- 活跃：- [ ] 复选框，完成后勾选 -->',
          '- [ ] 打开本项目的工作区',
          `- [ ] 归档「${ZH_NAME}」`,
          '- [ ] 开始用 Berth 管理你真正的工作 🎉', '',
          '## 决策 / 风险', '<!-- 活跃 -->', '',
          '## 进展日志', '<!-- 追加型：- YYYY-MM-DD: … -->', '',
        ].join('\n') + '\n'
      : [
          '# ✅ Finish the shakedown: archive this guide — Task context', '',
          '## Goal / Acceptance', '<!-- stable: do not change unless asked -->',
          'Archive the "Shakedown" project so the sidebar is left with just your own real projects.', '',
          '## Background', `<!-- stable: belongs to project ${EN_NAME} -->`,
          "You've walked Berth's main loop: grasped the idea, launched sessions from tasks, and asked all the common questions about importing sessions, context, and cargo. This guide project has done its job.", '',
          "Archiving does not delete anything — the project just folds out of the active list and can be brought back when needed. It also demonstrates Berth's project-archive capability.", '',
          '## Plan / TODO', '<!-- active: - [ ] checkboxes, tick when done -->',
          "- [ ] Open this project's workspace",
          `- [ ] Archive "${EN_NAME}"`,
          '- [ ] Start using Berth for your real work 🎉', '',
          '## Decisions / Risks', '<!-- active -->', '',
          '## Progress log', '<!-- append-only: - YYYY-MM-DD: … -->', '',
        ].join('\n') + '\n',
  }
}

function questionTasks(locale: Locale): OnboardingTask[] {
  const zh = locale !== 'en'
  return QUESTIONS.map((spec) => {
    const { q, answer } = zh ? spec.zh : spec.en
    return {
      id: spec.id, status: '待办', priority: spec.priority,
      title: `❓ ${q}`,
      doc: zh ? questionDocZh(q, answer) : questionDocEn(q, answer),
    }
  })
}

function projectDoc(locale: Locale): string {
  return locale === 'en'
    ? [
        `# ${EN_NAME} — Project context`, '',
        '## Goal / Why', '<!-- stable -->',
        "Berth's built-in getting-started project. Walk through the tasks below and you'll grasp Berth's core idea and main loop in a few minutes: organize work with projects and tasks; a session is just one voyage to get a task done.", '',
        '## Background / Constraints / Decisions', '<!-- stable -->',
        '- Berth manages **projects**, not sessions; **the task is the goal**, **a session is just one voyage** (sail out with context, bring back the deliverable, discard when done).',
        '- This project is a **sample**. Task 1 explains Berth; the **❓ question tasks** each answer one thing when you launch them; the last task archives the guide.',
        "- Don't want the tour? Just archive this project — it touches none of your real data.", '',
        '## Current status', '<!-- active: overwrite with "where it stands now" -->',
        'Waiting for the new user to start step one, "👋 Tell me what Berth is".', '',
        '## Key references / Entry points', '<!-- key dirs, files, specs, links -->',
        '- Sessions list: view / import / launch sessions in one place.',
        '- Settings: pick the CLI and default model used to launch sessions.', '',
        '## Progress log', '<!-- append-only: - YYYY-MM-DD: … -->', '',
      ].join('\n') + '\n'
    : [
        `# ${ZH_NAME} — 项目上下文`, '',
        '## 目标 / 为什么', '<!-- 稳定 -->',
        '这是 Berth 自带的新手引导项目。跟着下面的任务走一遍，几分钟摸清 Berth 的核心理念与主循环：用项目和任务组织工作，会话只是完成任务的一次航行。', '',
        '## 背景 / 约束 / 关键决策', '<!-- 稳定 -->',
        '- Berth 管的是**项目**，不是会话；**任务是最终目的**，**会话只是一次航行**（装上下文出航、带回交付物，用完即弃）。',
        '- 这个项目是**样例**。任务 1 讲清 Berth；中间的 **❓ 问题任务**点「启航」后让 agent 逐条答给你听；最后一条把引导归档。',
        '- 不想跟引导？直接归档本项目即可，不影响任何真实数据。', '',
        '## 当前状态', '<!-- 活跃：覆盖式更新为"现在进展到哪" -->',
        '等待新用户开始第一步「👋 告诉我什么是 Berth」。', '',
        '## 关键资料 / 入口', '<!-- 关键目录、文件、spec、链接 -->',
        '- 会话列表：集中查看 / 导入 / 启航会话。',
        '- 设置：选择启航会话用的 CLI 与默认模型。', '',
        '## 进展日志', '<!-- 追加型：- YYYY-MM-DD: … -->', '',
      ].join('\n') + '\n'
}

/** The onboarding project + task content for a locale. Status/priority are canonical, not localized. */
export function onboardingContent(locale: Locale): OnboardingContent {
  return {
    projectName: locale === 'en' ? EN_NAME : ZH_NAME,
    projectDoc: projectDoc(locale),
    tasks: [welcomeTask(locale), ...questionTasks(locale), archiveTask(locale)],
  }
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
  // Sort the guide LAST: a fresh user (guide is their only project) still lands on it via the
  // Home redirect, but an existing install getting the backfill keeps its own default-landing
  // project — the guide sits quietly at the bottom of the rail instead of hijacking the entry.
  if (project.id) store.setProjectSort(project.id, GUIDE_SORT)

  const projectAbs = docStore.resolveDocPath(docStore.projectDocRef(content.projectName))
  if (projectAbs) { try { docStore.writeDoc(projectAbs, content.projectDoc) } catch { /* best-effort */ } }

  const t = now()
  content.tasks.forEach((task, i) => {
    const ref = docStore.taskDocRef(task.id)
    const abs = docStore.resolveDocPath(ref)
    let detailDoc: string | null = null
    if (abs) { try { docStore.writeDoc(abs, task.doc); detailDoc = ref } catch { /* best-effort */ } }
    const row: Task = {
      id: task.id, title: task.title,
      status: validStatus(cfg.statuses, cfg.defaultStatus, task.status),
      priority: cfg.priorities.includes(task.priority) ? task.priority : cfg.defaultPriority,
      projectId: project.id ?? null, project: content.projectName,
      // Board sorts by updated_at DESC; stagger by index so the tasks keep their authored order.
      detailDoc, progress: null, updatedAt: t - i, syncedAt: 0, deleted: false,
    }
    store.insertTask(row)
  })

  store.setSetting('onboarding-seeded', '1')
  return true
}
