// Minimal string-table i18n for the BACKEND-injected, agent-facing text — the context manifest and
// the auto-submitted first task prompt — which otherwise bias every Berth-launched session toward one
// language. UI-string i18n for the frontend is tracked separately (and best paired with the React SPA
// migration); this module deliberately covers only the durable, agent-facing strings.
//
// Locale comes from app_setting `locale` (per-install config, like every other personal value).
// DEFAULT_LOCALE is currently 'zh-CN' to preserve an existing running instance; a future general-public
// release should flip the default to 'en' and add client Accept-Language / navigator.language detection.

export type Locale = 'en' | 'zh-CN'
export const LOCALES: Locale[] = ['zh-CN', 'en']
export const DEFAULT_LOCALE: Locale = 'zh-CN'

export function normalizeLocale(v: string | null | undefined): Locale {
  return v === 'en' || v === 'zh-CN' ? v : DEFAULT_LOCALE
}

/** Resolve the active locale from app settings (defaults to DEFAULT_LOCALE when unset/invalid). */
export function getLocale(store: { getSetting(key: string): string | null }): Locale {
  return normalizeLocale(store.getSetting('locale'))
}

export interface ManifestStrings {
  framing: (kindLabel: string) => string
  kindTask: string
  kindProject: string
  sectionTask: string
  labelTitle: string
  labelStatus: string
  labelPriority: string
  labelProject: string
  labelDetailDoc: string
  projectHeading: (name: string) => string
  pendingDetailDocs: string
  noDetailDoc: string
  footer: string
  truncated: string
}

export interface PromptStrings {
  // The visible first turn is intentionally just a title-naming directive. The detail-doc path and
  // the maintenance/finish rules are NOT repeated here — they ride in the manifest (claude system
  // prompt / codex+coco context hook), so the agent gets them implicitly without cluttering the
  // prompt the user sees in the terminal.
  start: (title: string) => string
}

const MANIFEST: Record<Locale, ManifestStrings> = {
  'zh-CN': {
    framing: (k) => `以下是本会话所属${k}的上下文索引，按需用 Read 自行展开，勿假设已加载全文`,
    kindTask: '任务',
    kindProject: '项目',
    sectionTask: '## 任务',
    labelTitle: '- 标题: ',
    labelStatus: '- 状态: ',
    labelPriority: '- 优先级: ',
    labelProject: '- 项目: ',
    labelDetailDoc: '- 详情文档: ',
    projectHeading: (n) => `## 项目: ${n}`,
    pendingDetailDocs: '### 待办详情文档',
    noDetailDoc: '(无详情文档)',
    footer: '> 以上为路径索引。如需完整内容，请用 Read 工具展开对应文件。',
    truncated: '\n…（超出预算，已截断）',
  },
  en: {
    framing: (k) => `Below is a context index for the ${k} this session belongs to. Expand entries with Read as needed; do not assume the full content is already loaded.`,
    kindTask: 'task',
    kindProject: 'project',
    sectionTask: '## Task',
    labelTitle: '- Title: ',
    labelStatus: '- Status: ',
    labelPriority: '- Priority: ',
    labelProject: '- Project: ',
    labelDetailDoc: '- Detail doc: ',
    projectHeading: (n) => `## Project: ${n}`,
    pendingDetailDocs: '### Pending task detail docs',
    noDetailDoc: '(no detail doc)',
    footer: '> The above is a path index. Use the Read tool to expand any file for its full content.',
    truncated: '\n…(over budget, truncated)',
  },
}

const PROMPT: Record<Locale, PromptStrings> = {
  'zh-CN': {
    start: (t) => `请开始处理任务：「${t}」。`,
  },
  en: {
    start: (t) => `Please start working on the task: "${t}".`,
  },
}

export function manifestStrings(locale: Locale): ManifestStrings {
  return MANIFEST[locale]
}
export function promptStrings(locale: Locale): PromptStrings {
  return PROMPT[locale]
}

export interface ContextStrings {
  compactRules: string[]                                  // 6–10 inlined rule lines
  logHeading: string                                      // '## 进展日志' — shared with rotateLog
  archiveTitle: string                                    // '# 进展归档'
  archivePointer: string                                  // pointer left at the log section top
  taskTemplate: (title: string, projectName: string) => string
  projectTemplate: (name: string) => string
  protocolDoc: string                                     // full default AGENTS.md body
  summaryPrompt: string                                  // headless prompt: summarize the doc into a short A snapshot
  // manifest "maintain" block labels
  sectionMaintain: string
  labelContextDoc: string
  labelProtocol: string
  // Phase-2 consolidation
  statusHeadingTask: string
  statusHeadingProject: string
  consolidatePrompt: (kind: 'task' | 'project', contextDoc: string, transcript: string) => string
  updatePrompt: (kind: 'task' | 'project', contextDoc: string,
                 src: { userInput: string; transcript: string; date: string }) => string
}

const CONTEXT: Record<Locale, ContextStrings> = {
  'zh-CN': {
    compactRules: [
      '维护规则：',
      '1. 开工前先 Read 下方「上下文文件」，了解目标/背景/进展。',
      '2. 收尾前向「## 进展日志」追加一行 `- YYYY-MM-DD: <一句话摘要>`；任务勾选已完成 TODO 并记录关键决策/风险，项目刷新「当前状态」。',
      '3. 进展日志条目过多时由 Berth 自动滚动归档，你只管追加。',
      '4. 不要擅自重写稳定段（目标/背景）；细则见下方「协议」文件，按需 Read。',
    ],
    logHeading: '## 进展日志',
    archiveTitle: '# 进展归档',
    archivePointer: '> 更早进展见 [归档](progress-archive.md)',
    taskTemplate: (title, project) => [
      `# ${title} — 任务上下文`, '',
      '## 目标 / 验收标准', '<!-- 稳定：除非被要求否则不改 -->', '', '',
      '## 背景', `<!-- 稳定：所属项目 ${project} -->`, '', '',
      '## 计划 / TODO', '<!-- 活跃：- [ ] 复选框，完成后勾选 -->', '', '',
      '## 决策 / 风险', '<!-- 活跃 -->', '', '',
      '## 进展日志', '<!-- 追加型：- YYYY-MM-DD: … -->', '',
    ].join('\n') + '\n',
    projectTemplate: (name) => [
      `# ${name} — 项目上下文`, '',
      '## 目标 / 为什么', '<!-- 稳定 -->', '', '',
      '## 背景 / 约束 / 关键决策', '<!-- 稳定 -->', '', '',
      '## 当前状态', '<!-- 活跃：覆盖式更新为"现在进展到哪" -->', '', '',
      '## 关键资料 / 入口', '<!-- 关键目录、文件、spec、链接 -->', '', '',
      '## 进展日志', '<!-- 追加型：- YYYY-MM-DD: … -->', '',
    ].join('\n') + '\n',
    protocolDoc: [
      '# Berth 上下文维护协议（AGENTS.md）', '',
      '本文件定义 Berth 启动的会话应如何维护其任务/项目上下文文件。可编辑；放在项目目录下（`projects/<name>/AGENTS.md`）即对该项目覆盖本默认。', '',
      '## 上下文文件', '- 任务：`tasks/<id>/index.md`；项目：`projects/<name>/index.md`。', '- 分稳定段（目标/背景）与活跃段（状态/TODO/决策）+ 追加型「## 进展日志」。', '',
      '## 你应做的', '1. 开工前 Read 上下文文件。', '2. 推进中更新活跃段；不要重写稳定段。', '3. 收尾前向「## 进展日志」追加一行 `- YYYY-MM-DD: 摘要`。', '',
      '## 进展日志', '只追加，最新在底部。条目过多时 Berth 会机械滚动到 `progress-archive.md`，你无需手动归档。', '',
    ].join('\n') + '\n',
    summaryPrompt: '以下是一个任务的上下文文档（含目标、计划、决策，及追加型进展日志）。只回复一段 2–3 句的简短进展摘要，用文档自身的语言，概括该任务当前进展到哪：已完成什么、进行中什么、关键决策/风险。忽略稳定的「目标/背景」段。不要 markdown、不要列表、不要引号。',
    sectionMaintain: '## 维护本上下文',
    labelContextDoc: '- 上下文文件: ',
    labelProtocol: '- 协议（细则按需 Read）: ',
    statusHeadingTask: '## 计划 / TODO',
    statusHeadingProject: '## 当前状态',
    consolidatePrompt: (kind, contextDoc, transcript) =>
      `你在维护一个${kind === 'task' ? '任务' : '项目'}的上下文文件。下面给你「当前上下文文件」和「本次会话的 transcript」。` +
      `请基于会话**实际发生的进展**，仅返回一个 JSON 对象（不要任何额外文字、不要代码围栏）：\n` +
      `{"progress":"<一行进展摘要，YYYY-MM-DD 开头，<=120字；没有实质进展则空字符串>",` +
      `"status":"<刷新后的${kind === 'task' ? '计划/TODO 勾选与下一步' : '当前状态'}，<=300字；不确定则空字符串>"}\n` +
      `规则：不要臆造未发生的事；不要重写目标/背景等稳定内容；只如实总结。\n` +
      `\n=== 当前上下文文件 ===\n${contextDoc.slice(0, 4000)}\n\n=== 会话 transcript（节选）===\n${transcript.slice(0, 8000)}`,
    updatePrompt: (kind, contextDoc, src) =>
      `你在维护一个${kind === 'task' ? '任务' : '项目'}的上下文文件（markdown）。下面给你「当前上下文文件全文」` +
      `${src.userInput ? '、用户补充的信息' : ''}${src.transcript ? '、本次会话 transcript' : ''}。\n` +
      `请把新信息融进上下文：可改写/新增任意段（目标、背景、当前状态/计划、关键资料等都可改），` +
      `并向「## 进展日志」追加一行 \`- ${src.date}: <一句话>\`。保持模板的标题结构。\n` +
      `只输出更新后的**完整 markdown 文档全文**，不要任何解释、不要代码围栏。若没有任何需要更新的内容，原样输出当前全文。\n` +
      (src.userInput ? `\n=== 用户补充的信息 ===\n${src.userInput.slice(0, 6000)}\n` : '') +
      (src.transcript ? `\n=== 会话 transcript（节选）===\n${src.transcript.slice(0, 8000)}\n` : '') +
      `\n=== 当前上下文文件全文 ===\n${contextDoc.slice(0, 8000)}`,
  },
  en: {
    compactRules: [
      'Maintenance rules:',
      '1. Before starting, Read the "context file" below for goal/background/progress.',
      '2. Before finishing, append one line to "## Progress log": `- YYYY-MM-DD: <one-line summary>`; for tasks tick completed TODOs and note key decisions/risks, for projects refresh "Current status".',
      '3. Berth auto-rolls the log when it grows; you only append.',
      '4. Do not rewrite the stable sections (goal/background); see the "protocol" file below and Read it as needed.',
    ],
    logHeading: '## Progress log',
    archiveTitle: '# Progress archive',
    archivePointer: '> Older progress in [archive](progress-archive.md)',
    taskTemplate: (title, project) => [
      `# ${title} — Task context`, '',
      '## Goal / Acceptance', '<!-- stable: do not change unless asked -->', '', '',
      '## Background', `<!-- stable: belongs to project ${project} -->`, '', '',
      '## Plan / TODO', '<!-- active: - [ ] checkboxes, tick when done -->', '', '',
      '## Decisions / Risks', '<!-- active -->', '', '',
      '## Progress log', '<!-- append-only: - YYYY-MM-DD: … -->', '',
    ].join('\n') + '\n',
    projectTemplate: (name) => [
      `# ${name} — Project context`, '',
      '## Goal / Why', '<!-- stable -->', '', '',
      '## Background / Constraints / Decisions', '<!-- stable -->', '', '',
      '## Current status', '<!-- active: overwrite with "where it stands now" -->', '', '',
      '## Key references / Entry points', '<!-- key dirs, files, specs, links -->', '', '',
      '## Progress log', '<!-- append-only: - YYYY-MM-DD: … -->', '',
    ].join('\n') + '\n',
    protocolDoc: [
      '# Berth context-maintenance protocol (AGENTS.md)', '',
      'Defines how Berth-launched sessions maintain their task/project context files. Editable; placing one at `projects/<name>/AGENTS.md` overrides this default for that project.', '',
      '## Context files', '- Task: `tasks/<id>/index.md`; project: `projects/<name>/index.md`.', '- Stable sections (goal/background) vs active sections (status/TODO/decisions) + an append-only "## Progress log".', '',
      '## What you should do', '1. Read the context file before starting.', '2. Update active sections as you go; never rewrite stable ones.', '3. Before finishing, append `- YYYY-MM-DD: summary` to "## Progress log".', '',
      '## Progress log', 'Append-only, newest at the bottom. Berth mechanically rolls it into `progress-archive.md` when it grows; no manual archiving needed.', '',
    ].join('\n') + '\n',
    summaryPrompt: "Below is a task's context document (goal, plan, decisions, and an append-only progress log). Reply with ONLY a 2-3 sentence progress summary, in the document's own language, of where the task currently stands: what's done, what's in progress, key decisions/risks. Ignore the stable goal/background sections. No markdown, no bullet lists, no quotes.",
    sectionMaintain: '## Maintain this context',
    labelContextDoc: '- Context file: ',
    labelProtocol: '- Protocol (Read for details): ',
    statusHeadingTask: '## Plan / TODO',
    statusHeadingProject: '## Current status',
    consolidatePrompt: (kind, contextDoc, transcript) =>
      `You are maintaining the context file of a ${kind}. Below are the "current context file" and the "transcript of this session". ` +
      `Based on what ACTUALLY happened in the session, reply with ONLY a JSON object (no extra text, no code fences):\n` +
      `{"progress":"<one-line progress summary, starting with YYYY-MM-DD, <=120 chars; empty string if no real progress>",` +
      `"status":"<refreshed ${kind === 'task' ? 'plan/TODO checkmarks and next step' : 'current status'}, <=300 chars; empty string if unsure>"}\n` +
      `Rules: do not invent things that did not happen; do not rewrite stable content like goal/background; summarize faithfully only.\n` +
      `\n=== Current context file ===\n${contextDoc.slice(0, 4000)}\n\n=== Session transcript (excerpt) ===\n${transcript.slice(0, 8000)}`,
    updatePrompt: (kind, contextDoc, src) =>
      `You maintain the context file (markdown) of a ${kind}. Below is the FULL current context file` +
      `${src.userInput ? ', user-supplied info' : ''}${src.transcript ? ', this session transcript' : ''}.\n` +
      `Fold the new info into the context: you may rewrite/add ANY section (goal, background, status/plan, key references, etc.), ` +
      `and append one line to "## Progress log": \`- ${src.date}: <one line>\`. Keep the template heading structure.\n` +
      `Output ONLY the FULL updated markdown document, with no explanation and no code fences. If nothing needs updating, output the current full text unchanged.\n` +
      (src.userInput ? `\n=== User-supplied info ===\n${src.userInput.slice(0, 6000)}\n` : '') +
      (src.transcript ? `\n=== Session transcript (excerpt) ===\n${src.transcript.slice(0, 8000)}\n` : '') +
      `\n=== Full current context file ===\n${contextDoc.slice(0, 8000)}`,
  },
}

export function contextStrings(locale: Locale): ContextStrings {
  return CONTEXT[locale]
}
