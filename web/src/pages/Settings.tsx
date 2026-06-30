import { useEffect, useState } from 'react'
import { Palette, Sparkles, Terminal, FileText, RefreshCw, ListChecks, X, Plus, ChevronLeft, ChevronRight, MessagesSquare, LifeBuoy, Download } from 'lucide-react'
import { exportDiagLog } from '@/lib/diag'
import { cn } from '@/lib/utils'
import { LIGHT_SCHEMES, DARK_SCHEMES, applyScheme, getScheme, type Scheme } from '@/lib/theme'
import { useData } from '@/lib/data'
import { useUI } from '@/lib/ui-store'
import { useLive } from '@/lib/live'
import { useInlineEdit } from '@/lib/useInlineEdit'
import { api } from '@/lib/api'
import type { AgentCli, AgentEntry } from '@/lib/api'
import { priorityColors } from '@/lib/priority'
import { statusMeta } from '@/lib/status'
import { Switch } from '@/components/ui/Switch'

export function Settings() {
  const [scheme, setScheme] = useState<string>(() => getScheme().id)
  const pick = (s: Scheme) => {
    applyScheme(s)
    setScheme(s.id)
  }
  const [proactive, setProactive] = useState(true)
  const [autoTitle, setAutoTitle] = useState(true)
  const { renderMode, setRenderMode } = useUI()
  // Switching render mode kills + respawns each session in the other mode (A↔B). Doing that to a
  // running session would interrupt its in-flight turn, so the toggle is locked while any session is
  // 在航 (running); it frees up once they all settle. Settled/idle sessions switch losslessly (resume).
  const live = useLive()
  const anyRunning = [...live.activity.values()].some((s) => s === 'running')

  // Task-field vocabularies — edited as a local draft seeded from the live config; persisted
  // (POST /settings) + reload() so the whole app picks up the new statuses/priorities.
  const { statuses: cfgStatuses, priorities: cfgPriorities, agents: cfgAgents, reload } = useData()
  const [statuses, setStatuses] = useState<string[]>(cfgStatuses)
  const [priorities, setPriorities] = useState<string[]>(cfgPriorities)
  const [agentList, setAgentList] = useState<AgentEntry[]>(cfgAgents.list)
  const [berthAgentCli, setBerthAgentCli] = useState<AgentCli>(cfgAgents.berthAgentCli)
  const [berthAgentModel, setBerthAgentModel] = useState(cfgAgents.berthAgentModel)
  const [savingVocab, setSavingVocab] = useState(false)
  const [savingAgents, setSavingAgents] = useState(false)
  const [agentError, setAgentError] = useState<string | null>(null)
  useEffect(() => setStatuses(cfgStatuses), [cfgStatuses])
  useEffect(() => setPriorities(cfgPriorities), [cfgPriorities])
  useEffect(() => setAgentList(cfgAgents.list), [cfgAgents.list])
  useEffect(() => setBerthAgentCli(cfgAgents.berthAgentCli), [cfgAgents.berthAgentCli])
  useEffect(() => setBerthAgentModel(cfgAgents.berthAgentModel), [cfgAgents.berthAgentModel])
  const vocabDirty =
    statuses.join('\0') !== cfgStatuses.join('\0') || priorities.join('\0') !== cfgPriorities.join('\0')
  const agentDirty =
    JSON.stringify(agentList) !== JSON.stringify(cfgAgents.list) ||
    berthAgentCli !== cfgAgents.berthAgentCli ||
    berthAgentModel !== cfgAgents.berthAgentModel
  const enabledHeadless = cfgAgents.headlessClis.filter((cli) => agentList.find((a) => a.cli === cli)?.enabled)
  const updateAgent = (cli: AgentCli, patch: Partial<AgentEntry>) => {
    setAgentError(null)
    const next = agentList.map((a) => (a.cli === cli ? { ...a, ...patch, model: cli === 'coco' ? null : patch.model === undefined ? a.model : patch.model } : a))
    const nextEnabledHeadless = cfgAgents.headlessClis.filter((c) => next.find((a) => a.cli === c)?.enabled)
    setAgentList(next)
    if (!nextEnabledHeadless.includes(berthAgentCli) && nextEnabledHeadless[0]) setBerthAgentCli(nextEnabledHeadless[0])
  }
  const saveVocab = () => {
    setSavingVocab(true)
    api
      .saveSettings({ statuses, priorities })
      .then(() => reload())
      .finally(() => setSavingVocab(false))
  }
  const saveAgents = () => {
    setSavingAgents(true)
    setAgentError(null)
    api
      .saveSettings({ agents: { list: agentList, berthAgentCli, berthAgentModel } })
      .then(() => reload())
      .catch((e) => setAgentError(String(e?.message ?? e)))
      .finally(() => setSavingAgents(false))
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="elev-header sticky top-0 z-10 bg-background px-6 py-4">
        <h1 className="text-[17px] font-bold text-foreground">设置</h1>
      </header>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-5">
        <Card icon={<Palette size={14} />} title="外观" hint="选择日间 / 夜间配色方案（即时生效）">
          <Row label="日间">
            <div className="flex flex-wrap gap-2">
              {LIGHT_SCHEMES.map((s) => (
                <SchemeSwatch key={s.id} s={s} active={scheme === s.id} onPick={() => pick(s)} />
              ))}
            </div>
          </Row>
          <Row label="夜间">
            <div className="flex flex-wrap gap-2">
              {DARK_SCHEMES.map((s) => (
                <SchemeSwatch key={s.id} s={s} active={scheme === s.id} onPick={() => pick(s)} />
              ))}
            </div>
          </Row>
        </Card>

        {/* 会话渲染模式——功能尚未开发完成，暂时隐藏 */}
        {false && (
        <Card icon={<MessagesSquare size={14} />} title="会话渲染" hint="全局生效 · 决定会话面板用哪种方式呈现（claude / codex / coco 均支持对话模式）">
          <Row label="渲染模式">
            <div className={cn('flex items-center gap-1 rounded-md border border-border p-0.5', anyRunning && 'opacity-50')}>
              <ModeBtn active={renderMode === 'A'} disabled={anyRunning} onClick={() => setRenderMode('A')} label="终端" hint="原生 CLI 界面 · 可交互" />
              <ModeBtn active={renderMode === 'B'} disabled={anyRunning} onClick={() => setRenderMode('B')} label="对话" hint="气泡 + 工具调用折叠" />
            </div>
            <span className="text-[11px] text-text-dim">
              {anyRunning
                ? '有会话在航中——切换会打断进行中的回合，已暂时锁定；待全部靠岸后可切换'
                : renderMode === 'B'
                  ? '对话：用户右气泡 / agent 左气泡 · 工具调用结束后自动折叠'
                  : '终端：保留完整交互连贯性（输入 / Ctrl-C / TUI）'}
            </span>
          </Row>
        </Card>
        )}

        <Card icon={<Sparkles size={14} />} title="港务助手 (AI)" hint="用于：会话标题 · 任务进展 · 项目小结 · 关联建议">
          <Row label="管理模型">
            <select
              value={berthAgentCli}
              onChange={(e) => setBerthAgentCli(e.target.value as AgentCli)}
              className="rounded-md border border-border bg-card px-2 py-1 text-[12px] text-foreground outline-none"
            >
              {enabledHeadless.map((cli) => <option key={cli} value={cli}>{cli}</option>)}
            </select>
            <input
              value={berthAgentModel}
              onChange={(e) => setBerthAgentModel(e.target.value)}
              placeholder="留空 = CLI 默认模型"
              className="min-w-0 flex-1 rounded-md border border-border bg-card px-2 py-1 text-[12px] text-foreground outline-none placeholder:text-text-dim"
            />
          </Row>
          <ToggleRow label="主动提议建议" hint="船返港且有产出时给建议卡（可关）" on={proactive} onChange={() => setProactive((v) => !v)} />
          <ToggleRow label="新建任务默认 AI 自动总结标题" on={autoTitle} onChange={() => setAutoTitle((v) => !v)} />
        </Card>

        <Card icon={<Terminal size={14} />} title="启动 Agents" hint="可被起航装载的 CLI">
          {agentList.map((agent) => (
            <AgentRow
              key={agent.cli}
              agent={agent}
              enabledCount={agentList.filter((a) => a.enabled).length}
              onChange={(patch) => updateAgent(agent.cli, patch)}
            />
          ))}
          {(agentDirty || agentError) && (
            <div className="flex items-center gap-2 border-t border-border pt-2.5">
              <span className={cn('text-[11px]', agentError ? 'text-destructive' : 'text-warning')}>
                {agentError ?? '有未保存的 Agent 改动'}
              </span>
              <span className="flex-1" />
              <button
                onClick={() => {
                  setAgentList(cfgAgents.list)
                  setBerthAgentCli(cfgAgents.berthAgentCli)
                  setBerthAgentModel(cfgAgents.berthAgentModel)
                  setAgentError(null)
                }}
                className="rounded-md border border-border px-3 py-1 text-[12px] text-muted-foreground hover:bg-accent"
              >
                还原
              </button>
              <button
                onClick={saveAgents}
                disabled={savingAgents || enabledHeadless.length === 0}
                className="rounded-md bg-brand px-3 py-1 text-[12px] font-medium text-brand-foreground hover:brightness-110 disabled:opacity-60"
              >
                {savingAgents ? '保存中…' : '保存'}
              </button>
            </div>
          )}
        </Card>

        <Card icon={<FileText size={14} />} title="上下文与文档" hint="任务/项目的 md 与图片">
          <Row label="上下文文档根目录">
            <code className="rounded bg-card px-2 py-1 font-mono text-[12px] text-foreground">~/.berth/docs</code>
            <button className="rounded-md border border-border px-2 py-1 text-[12px] hover:bg-accent">选择</button>
          </Row>
        </Card>

        <Card icon={<LifeBuoy size={14} />} title="诊断日志" hint="会话启动 / 连接 / 时序的埋点；遇到问题导出后发给维护者排查">
          <DiagnosticsRow />
        </Card>

        {/* 数据源 / 同步——暂时隐藏 */}
        {false && (
        <Card icon={<RefreshCw size={14} />} title="数据源 / 同步" hint="任务/项目可双向同步到外部系统">
          <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
            <span className="text-[13px] text-foreground">Feishu 多维表格</span>
            <span className="rounded bg-success/15 px-1.5 py-0.5 text-[10.5px] text-success">已连接</span>
            <span className="flex-1" />
            <span className="text-[11px] text-muted-foreground">拉取</span><Select options={['手动', '自动']} />
            <span className="text-[11px] text-muted-foreground">推送</span><Select options={['手动', '自动']} />
          </div>
          <div className="flex items-center gap-2">
            <button className="rounded-md border border-border px-3 py-1 text-[12px] hover:bg-accent">Pull</button>
            <button className="rounded-md border border-border px-3 py-1 text-[12px] hover:bg-accent">Push</button>
            <span className="text-[11px] text-text-dim">0 个冲突</span>
            <span className="flex-1" />
            <button className="flex items-center gap-1 text-[12px] text-brand hover:underline"><Plus size={12} /> 添加数据源</button>
          </div>
        </Card>
        )}

        <Card icon={<ListChecks size={14} />} title="任务字段" hint="状态 = 看板列（按顺序）· 优先级按顺序高→低着色">
          <Row label="状态选项">
            <VocabEditor
              items={statuses}
              onChange={setStatuses}
              addLabel="状态"
              renderChip={(s) => {
                const m = statusMeta(s)
                return (
                  <>
                    <span className={cn('h-1.5 w-1.5 flex-none rounded-full', m.dot)} />
                    {s}
                  </>
                )
              }}
            />
          </Row>
          <Row label="优先级选项">
            <VocabEditor
              items={priorities}
              onChange={setPriorities}
              addLabel="优先级"
              orderHint="高 → 低"
              renderChip={(p, i, total) => {
                const c = priorityColors(i, total)
                return (
                  <span className="rounded px-1.5 font-bold" style={{ background: c.chipBg, color: c.chipFg }}>
                    {p}
                  </span>
                )
              }}
            />
          </Row>
          {vocabDirty && (
            <div className="flex items-center gap-2 border-t border-border pt-2.5">
              <span className="text-[11px] text-warning">有未保存的改动 — 保存后全局生效</span>
              <span className="flex-1" />
              <button
                onClick={() => {
                  setStatuses(cfgStatuses)
                  setPriorities(cfgPriorities)
                }}
                className="rounded-md border border-border px-3 py-1 text-[12px] text-muted-foreground hover:bg-accent"
              >
                还原
              </button>
              <button
                onClick={saveVocab}
                disabled={savingVocab}
                className="rounded-md bg-brand px-3 py-1 text-[12px] font-medium text-brand-foreground hover:brightness-110 disabled:opacity-60"
              >
                {savingVocab ? '保存中…' : '保存'}
              </button>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function SchemeSwatch({ s, active, onPick }: { s: Scheme; active: boolean; onPick: () => void }) {
  const bg = s.vars['--color-background']
  const card = s.vars['--color-card']
  const brand = s.vars['--color-brand']
  const border = s.vars['--color-border']
  return (
    <button
      onClick={onPick}
      className={cn(
        'flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]',
        active ? 'border-brand text-foreground ring-1 ring-brand/40' : 'border-border text-muted-foreground hover:text-foreground',
      )}
    >
      <span className="flex overflow-hidden rounded" style={{ outline: `1px solid ${border}` }}>
        <span className="h-3.5 w-3.5" style={{ background: bg }} />
        <span className="h-3.5 w-3.5" style={{ background: card }} />
        <span className="h-3.5 w-3.5" style={{ background: brand }} />
      </span>
      {s.name}
      {active && <span className="text-brand">✓</span>}
    </button>
  )
}

/** Editable ordered vocabulary (status / priority): chip + reorder ◀▶ + remove ✕, plus add.
 *  Order is meaningful — status order = kanban columns, priority order = high→low ramp. */
function VocabEditor({
  items,
  onChange,
  addLabel,
  orderHint,
  renderChip,
}: {
  items: string[]
  onChange: (next: string[]) => void
  addLabel: string
  orderHint?: string
  renderChip: (item: string, index: number, total: number) => React.ReactNode
}) {
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= items.length) return
    const next = items.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  const remove = (i: number) => onChange(items.filter((_, k) => k !== i))
  // Inline add — Electron has no window.prompt(); the "+ 添加" button reveals an input.
  const { editing: adding, start: startAdd, inputProps: addInput } = useInlineEdit('', (v) => {
    if (v && !items.includes(v)) onChange([...items, v])
  })
  return (
    <div className="flex flex-1 flex-wrap items-center gap-1.5">
      {items.map((it, i) => (
        <span key={it} className="group flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 text-[11px] text-foreground">
          <button onClick={() => move(i, -1)} disabled={i === 0} className="text-text-dim hover:text-foreground disabled:opacity-25" title="前移"><ChevronLeft size={11} /></button>
          {renderChip(it, i, items.length)}
          <button onClick={() => move(i, 1)} disabled={i === items.length - 1} className="text-text-dim hover:text-foreground disabled:opacity-25" title="后移"><ChevronRight size={11} /></button>
          <button onClick={() => remove(i)} className="ml-0.5 text-text-dim hover:text-destructive" title="删除"><X size={10} /></button>
        </span>
      ))}
      {adding ? (
        <input
          {...addInput}
          placeholder={`新增${addLabel}`}
          className="h-[22px] w-28 rounded-md border border-input bg-background px-1.5 text-[11px] text-foreground outline-none focus:border-ring"
        />
      ) : (
        <button onClick={startAdd} className="rounded-md border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-brand hover:text-brand">+ 添加</button>
      )}
      {orderHint && <span className="ml-1 text-[10.5px] text-text-dim">{orderHint}</span>}
    </div>
  )
}

function Card({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-baseline gap-2">
        <span className="text-brand">{icon}</span>
        <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
        <span className="ml-auto text-[11px] text-text-dim">{hint}</span>
      </div>
      <div className="mt-3 flex flex-col gap-2.5">{children}</div>
    </section>
  )
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-32 flex-none text-[12px] text-muted-foreground">{label}</span>
      <div className="flex flex-1 items-center gap-2">{children}</div>
    </div>
  )
}
function DiagnosticsRow() {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const onExport = async () => {
    setBusy(true)
    setDone(false)
    try {
      await exportDiagLog()
      setDone(true)
      window.setTimeout(() => setDone(false), 2500)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onExport}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] hover:bg-accent disabled:opacity-50"
      >
        <Download size={13} /> {busy ? '导出中…' : '导出诊断日志'}
      </button>
      <span className="text-[11px] text-text-dim">
        {done ? '已导出 ✓' : '下载一个 JSON 文件（前后端事件时间线），可直接发给维护者'}
      </span>
    </div>
  )
}
function ModeBtn({ active, onClick, label, hint, disabled }: { active: boolean; onClick: () => void; label: string; hint: string; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? '有会话在航，暂不可切换' : hint}
      className={cn(
        'rounded px-3 py-1 text-[12px]',
        active ? 'bg-brand text-brand-foreground' : 'text-muted-foreground hover:text-foreground',
        disabled && 'cursor-not-allowed hover:text-muted-foreground',
      )}
    >
      {label}
    </button>
  )
}
function ToggleRow({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1">
        <div className="text-[12px] text-foreground">{label}</div>
        {hint && <div className="text-[11px] text-text-dim">{hint}</div>}
      </div>
      <Switch checked={on} onChange={onChange} />
    </div>
  )
}
function Segmented({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="flex rounded-md border border-border p-0.5">
      {options.map(([v, l]) => (
        <button key={v} onClick={() => onChange(v)} className={cn('rounded px-2.5 py-0.5 text-[12px]', value === v ? 'bg-brand text-brand-foreground' : 'text-muted-foreground')}>{l}</button>
      ))}
    </div>
  )
}
function Select({ options }: { options: string[] }) {
  return (
    <select className="rounded-md border border-border bg-card px-2 py-1 text-[12px] text-foreground outline-none">
      {options.map((o) => <option key={o}>{o}</option>)}
    </select>
  )
}
function agentTone(cli: AgentCli): string {
  if (cli === 'claude') return 'text-brand'
  if (cli === 'codex') return 'text-success'
  return 'text-purple'
}

function AgentRow({
  agent,
  enabledCount,
  onChange,
}: {
  agent: AgentEntry
  enabledCount: number
  onChange: (patch: Partial<AgentEntry>) => void
}) {
  const canDisable = !agent.enabled || enabledCount > 1
  return (
    <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
      <span className={cn('w-16 text-[13px] font-semibold', agentTone(agent.cli))}>{agent.cli}</span>
      <span className="flex-1" />
      {agent.cli === 'coco' ? (
        <span className="text-[12px] text-text-dim">coco 无 --model</span>
      ) : (
        <input
          value={agent.model ?? ''}
          onChange={(e) => onChange({ model: e.target.value.trim() ? e.target.value : null })}
          placeholder="CLI 默认模型"
          className="w-48 rounded-md border border-border bg-card px-2 py-1 text-[12px] text-foreground outline-none placeholder:text-text-dim"
        />
      )}
      <span className="text-[11px] text-muted-foreground" title="开启后该 agent 每次工具调用前请求授权（仅交互式会话生效）">安全</span>
      <Switch
        checked={agent.safeMode}
        onChange={() => onChange({ safeMode: !agent.safeMode })}
        title={agent.safeMode ? '安全模式：开（启动时请求授权）' : '安全模式：关（最高权限）'}
      />
      <Switch
        checked={agent.enabled}
        onChange={() => canDisable && onChange({ enabled: !agent.enabled })}
        disabled={!canDisable}
        title={!canDisable ? '至少保留一个启动 Agent' : agent.enabled ? '停用' : '启用'}
      />
    </div>
  )
}
