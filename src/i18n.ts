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
  sectionProgress: string
  projectHeading: (name: string) => string
  pendingDetailDocs: string
  noDetailDoc: string
  footer: string
  truncated: string
}

export interface PromptStrings {
  start: (title: string) => string
  detail: (path: string) => string
  finish: string
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
    sectionProgress: '## 进展记录',
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
    sectionProgress: '## Progress',
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
    detail: (p) => `详情文档：${p}（动手前请先 Read 展开）。`,
    finish: '完成后在该任务的「进展记录」中简要记录结果；遇到需要我确认的关键决策再停下来问我。',
  },
  en: {
    start: (t) => `Please start working on the task: "${t}".`,
    detail: (p) => `Detail doc: ${p} (Read it before you begin).`,
    finish: "When done, briefly record the result in the task's progress notes; stop and ask me when you hit a key decision that needs my confirmation.",
  },
}

export function manifestStrings(locale: Locale): ManifestStrings {
  return MANIFEST[locale]
}
export function promptStrings(locale: Locale): PromptStrings {
  return PROMPT[locale]
}
