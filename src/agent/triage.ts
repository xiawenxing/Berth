import { runAgent, type BerthAgent } from './index'

export interface ProjectCandidate { name: string; confidence: number }
export interface ClassifyResult {
  candidates: ProjectCandidate[]   // only names ∈ projectNames, sorted desc by confidence
  needNewProject: boolean
  suggestedNewName?: string
}

export async function classifyProject(text: string, projectNames: string[], agent?: BerthAgent): Promise<ClassifyResult> {
  const prompt =
    `You are routing a personal todo to a project. Known projects:\n` +
    projectNames.map(n => `- ${n}`).join('\n') +
    `\n\nTodo: "${text}"\n\n` +
    `Reply with ONLY JSON: {"candidates":[{"name":<exact known project>,"confidence":0..1}],` +
    `"needNewProject":bool,"suggestedNewName":<short name or omit>}. ` +
    `List 0-3 candidates, highest confidence first. If none fit, candidates:[] and needNewProject:true.`
  let raw = ''
  const cli = agent?.cli ?? 'claude'
  const model = agent ? (agent.model || undefined) : 'claude-haiku-4-5'
  try { raw = await runAgent(prompt, { cli, model, timeoutMs: 30000 }) } catch { return { candidates: [], needNewProject: true } }
  const json = extractJson(raw)
  if (!json) return { candidates: [], needNewProject: true }
  const known = new Set(projectNames)
  const candidates: ProjectCandidate[] = Array.isArray(json.candidates)
    ? json.candidates
        .filter((c: any) => c && known.has(c.name) && typeof c.confidence === 'number')
        .map((c: any) => ({ name: c.name, confidence: Math.max(0, Math.min(1, c.confidence)) }))
        .sort((a: ProjectCandidate, b: ProjectCandidate) => b.confidence - a.confidence)
    : []
  return {
    candidates,
    needNewProject: candidates.length === 0 ? true : !!json.needNewProject,
    suggestedNewName: typeof json.suggestedNewName === 'string' ? json.suggestedNewName : undefined,
  }
}

function extractJson(s: string): any | null {
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fence ? fence[1] : s
  const a = body.indexOf('{'); const b = body.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try { return JSON.parse(body.slice(a, b + 1)) } catch { return null }
}
