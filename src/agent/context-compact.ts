import { extractMarkdownDoc } from './context-update'
import { runAgent, type BerthAgent } from './index'
import type { ContextCompactionSummaryInput } from '../data/context-doc'

type RunAgentFn = (prompt: string, opts: { cli?: BerthAgent['cli']; model?: string; timeoutMs?: number }) => Promise<string>

function sampleDoc(doc: string): string {
  if (doc.length <= 80_000) return doc
  return [
    doc.slice(0, 52_000),
    '\n\n<!-- Berth omitted the middle of the oversized context from this summarization prompt; the reference file preserves the complete original. -->\n\n',
    doc.slice(-24_000),
  ].join('')
}

function compactPrompt(input: ContextCompactionSummaryInput): string {
  const zh = input.locale === 'zh-CN'
  const budget = Math.max(800, input.keepChars)
  if (zh) {
    return [
      '你在为 Berth 维护一个已经超长的任务/项目上下文主文档。',
      'Berth 已经把“拆分前完整上下文”原封不动保存到了 reference 子文档；你不能也不需要保留所有细节。',
      '',
      '你的任务：只输出新的主上下文 markdown 全文，用于后续 agent 快速接手工作。',
      '',
      '硬性要求：',
      `- 必须包含 reference 链接路径：${input.referenceRel}`,
      '- 必须保留原文的 H1 标题语言与大体模板结构。',
      '- 必须有“参考子文档”段，说明完整历史和细节在 reference 中。',
      '- 不要删除事实，而是把低频细节迁移为“见 reference”；主文档保留目标、当前状态、关键约束、关键决策、风险、下一步和最近进展。',
      `- “${input.logHeading}”只保留最近 ${input.logKeep} 条左右；更早流水不要逐条复制，概括并指向 reference。`,
      `- 输出尽量控制在 ${budget} 字符以内；不要代码围栏，不要解释文字。`,
      '',
      '可参考的确定性压缩版本如下；你可以改写得更有条理，但必须保留 reference 链接：',
      input.fallbackDoc.slice(0, 24_000),
      '',
      '=== 拆分前完整上下文（用于总结，reference 已完整保存）===',
      sampleDoc(input.doc),
    ].join('\n')
  }
  return [
    'You maintain an oversized Berth task/project context main document.',
    'Berth has already preserved the complete pre-split context verbatim in a reference child document; you do not need to keep every detail in the main file.',
    '',
    'Your task: output ONLY the new main context markdown document for future agents to quickly resume work.',
    '',
    'Hard requirements:',
    `- Include this reference link path exactly: ${input.referenceRel}`,
    '- Preserve the original H1 language and roughly the same template structure.',
    '- Include a "Reference documents" section explaining that full history/details live in the reference.',
    '- Do not destroy facts; move low-frequency detail behind the reference. Keep goals, current status, key constraints, decisions, risks, next steps, and recent progress in the main doc.',
    `- Keep only about the latest ${input.logKeep} entries in "${input.logHeading}"; summarize older流水/history and point to the reference.`,
    `- Keep the output around ${budget} chars or less. No code fences, no explanation.`,
    '',
    'Here is the deterministic fallback compacted version; improve its organization while keeping the reference link:',
    input.fallbackDoc.slice(0, 24_000),
    '',
    '=== Full pre-split context for summarization (already preserved in the reference) ===',
    sampleDoc(input.doc),
  ].join('\n')
}

export async function summarizeCompactedContext(
  input: ContextCompactionSummaryInput,
  agent: BerthAgent,
  runAgentFn: RunAgentFn = runAgent,
): Promise<string | null> {
  const raw = await runAgentFn(compactPrompt(input), {
    cli: agent.cli,
    model: agent.model || undefined,
    timeoutMs: 120000,
  })
  const doc = extractMarkdownDoc(raw)
  return doc || null
}

