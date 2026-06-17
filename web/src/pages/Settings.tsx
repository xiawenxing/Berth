import { useState } from 'react'
import { Palette, Sparkles, Terminal, FileText, RefreshCw, ListChecks, X, Plus, FolderInput } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LIGHT_SCHEMES, DARK_SCHEMES, applyScheme, getScheme, type Scheme } from '@/lib/theme'

export function Settings() {
  const [scheme, setScheme] = useState<string>(() => getScheme().id)
  const pick = (s: Scheme) => {
    applyScheme(s)
    setScheme(s.id)
  }
  const [proactive, setProactive] = useState(true)
  const [autoTitle, setAutoTitle] = useState(true)
  const [dirs, setDirs] = useState(['~/Code/berth', '~/Code', '~/.config'])
  const [statuses, setStatuses] = useState(['待办', '进行中', '待评估', '已完成', '已取消'])

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="sticky top-0 z-10 border-b border-border bg-background px-6 py-4">
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

        <Card icon={<Sparkles size={14} />} title="港务助手 (AI)" hint="用于：会话标题 · 任务进展 · 项目小结 · 关联建议">
          <Row label="管理模型">
            <Select options={['claude', 'codex']} />
            <Select options={['haiku', 'sonnet', 'opus']} />
          </Row>
          <ToggleRow label="主动提议建议" hint="船返港且有产出时给建议卡（可关）" on={proactive} onChange={() => setProactive((v) => !v)} />
          <ToggleRow label="新建任务默认 AI 自动总结标题" on={autoTitle} onChange={() => setAutoTitle((v) => !v)} />
        </Card>

        <Card icon={<Terminal size={14} />} title="启动 Agents" hint="可被起航装载的 CLI">
          <AgentRow cli="claude" tone="text-brand" models={['haiku', 'sonnet', 'opus']} />
          <AgentRow cli="codex" tone="text-success" models={['o3', 'o4-mini']} />
          <AgentRow cli="coco" tone="text-purple" models={null} />
        </Card>

        <Card icon={<FileText size={14} />} title="上下文与文档" hint="任务/项目的 md 与图片 · 会话导入目录">
          <Row label="上下文文档根目录">
            <code className="rounded bg-card px-2 py-1 font-mono text-[12px] text-foreground">~/.berth/docs</code>
            <button className="rounded-md border border-border px-2 py-1 text-[12px] hover:bg-accent">选择</button>
          </Row>
          <div className="text-[11px] text-muted-foreground">会话导入目录</div>
          {dirs.map((d) => (
            <div key={d} className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5">
              <code className="flex-1 font-mono text-[12px] text-foreground">{d}</code>
              <button onClick={() => setDirs((x) => x.filter((y) => y !== d))} className="text-text-dim hover:text-destructive"><X size={13} /></button>
            </div>
          ))}
          <button className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-[12px] text-muted-foreground hover:border-brand hover:text-brand"><FolderInput size={13} /> 导入目录</button>
        </Card>

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

        <Card icon={<ListChecks size={14} />} title="任务字段" hint="自定义任务的状态与优先级取值">
          <Row label="状态选项">
            <div className="flex flex-wrap gap-1.5">
              {statuses.map((s) => (
                <span key={s} className="flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-[11px] text-foreground">
                  {s}<button onClick={() => setStatuses((x) => x.filter((y) => y !== s))} className="text-text-dim hover:text-destructive"><X size={10} /></button>
                </span>
              ))}
              <button className="rounded border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-brand">+ 添加</button>
            </div>
          </Row>
          <Row label="优先级选项">
            <div className="flex gap-1.5">
              <span className="rounded bg-destructive/15 px-2 py-0.5 text-[11px] text-destructive">P0</span>
              <span className="rounded bg-priority/15 px-2 py-0.5 text-[11px] text-priority">P1</span>
              <span className="rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">P2</span>
            </div>
          </Row>
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
function ToggleRow({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1">
        <div className="text-[12px] text-foreground">{label}</div>
        {hint && <div className="text-[11px] text-text-dim">{hint}</div>}
      </div>
      <Toggle on={on} onChange={onChange} />
    </div>
  )
}
function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange} className={cn('flex h-5 w-9 flex-none items-center rounded-full px-0.5 transition-colors', on ? 'bg-success/70' : 'bg-muted')}>
      <span className={cn('h-4 w-4 rounded-full bg-card-foreground transition-transform', on && 'translate-x-4')} />
    </button>
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
function AgentRow({ cli, tone, models }: { cli: string; tone: string; models: string[] | null }) {
  const [on, setOn] = useState(true)
  return (
    <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
      <span className={cn('text-[13px] font-semibold', tone)}>{cli}</span>
      <span className="flex-1" />
      {models ? <Select options={models} /> : <span className="text-[12px] text-text-dim">— · coco 无 --model</span>}
      <Toggle on={on} onChange={() => setOn((v) => !v)} />
    </div>
  )
}
