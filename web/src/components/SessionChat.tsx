import { useState } from 'react'
import { ChevronRight, Copy, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Codex-style conversation: user bubbles right, agent rich text left,
 * collapsible 执行过程, code block w/ copy, file-edit card. Mock content for now;
 * a real session feeds parsed transcript turns in a later phase.
 */
export function SessionChat({ firstUser }: { firstUser?: string }) {
  const [procOpen, setProcOpen] = useState(false)
  return (
    <div className="flex flex-col gap-4 px-5 py-4 text-[13px]">
      <UserMsg>{firstUser ?? '把会话列表从活跃/已归档改成 pin 加 cwd 分组，这周做完'}</UserMsg>

      <AgentMsg>
        <p>
          已确定方案：砍掉 <code className="rounded bg-muted px-1 font-mono text-[12px]">活跃/已归档</code>，改为{' '}
          <code className="rounded bg-muted px-1 font-mono text-[12px]">pin + 按 cwd 分组</code>。下面是核心改动。
        </p>

        <button
          onClick={() => setProcOpen((v) => !v)}
          className="mt-2 flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
        >
          <ChevronRight size={13} className={cn('transition-transform', procOpen && 'rotate-90')} />
          执行过程 · 用时 1m28s
        </button>
        {procOpen && (
          <div className="mt-1 rounded-md border border-border bg-background/40 p-2 font-mono text-[11.5px] text-text-dim">
            <div>$ rg "活跃|已归档" public/app.js</div>
            <div>  4180: 活跃/已归档 grouping…</div>
            <div>$ npm test — 433 passed</div>
          </div>
        )}

        <CodeBlock />

        <FileEditCard />
        <div className="mt-1 text-[11px] text-text-dim">11:03</div>
      </AgentMsg>

      <UserMsg>这么改 50 个会话时会不会很长？</UserMsg>
      <AgentMsg>
        <p>长 cwd 组加了 show-more（默认显 4 行），已停泊会话不显状态点，列表密度可控。</p>
        <div className="mt-1 text-[11px] text-text-dim">11:31</div>
      </AgentMsg>
    </div>
  )
}

function UserMsg({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[72%] rounded-md bg-secondary px-3 py-2 text-foreground">{children}</div>
    </div>
  )
}

function AgentMsg({ children }: { children: React.ReactNode }) {
  return <div className="max-w-[88%] leading-relaxed text-foreground">{children}</div>
}

function CodeBlock() {
  return (
    <div className="relative mt-2 rounded-md border border-border bg-background/60 p-3 font-mono text-[12px]">
      <button className="absolute right-2 top-2 rounded p-1 text-text-dim hover:bg-muted hover:text-foreground" title="复制">
        <Copy size={12} />
      </button>
      <pre className="overflow-x-auto text-foreground">{`function groupSessionsByCwd(sessions) {
  const map = new Map()
  for (const s of sessions) {
    const k = s.cwd || '__no_cwd__'
    ;(map.get(k) ?? map.set(k, []).get(k)).push(s)
  }
  return [...map]
}`}</pre>
    </div>
  )
}

function FileEditCard() {
  return (
    <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
      <FileText size={14} className="text-muted-foreground" />
      <span className="text-[12px] text-foreground">已编辑 public/app.js</span>
      <span className="font-mono text-[11px] text-success">+132</span>
      <span className="font-mono text-[11px] text-destructive">−58</span>
      <button className="ml-auto text-[11px] text-brand hover:underline">查看</button>
    </div>
  )
}
