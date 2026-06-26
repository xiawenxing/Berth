import { FolderInput, Hash, Terminal } from 'lucide-react'
import { Dialog } from '@/components/ui/Overlay'

export type ImportChoice =
  | { type: 'cli'; cli: 'claude' | 'codex' | 'coco' }
  | { type: 'path' }
  | { type: 'id' }

/**
 * First-step chooser shown by the 无归属会话 顶栏「导入目录」按钮: pick HOW to import before any
 * picker opens. Pure UI — emits the chosen entry; Unassigned routes it to the matching dialog/flow.
 */
export function ImportChooser({ onPick, onCancel }: { onPick: (c: ImportChoice) => void; onCancel: () => void }) {
  const entries: { choice: ImportChoice; icon: JSX.Element; title: string; sub: string }[] = [
    { choice: { type: 'cli', cli: 'claude' }, icon: <Terminal size={15} />, title: '导入 Claude 会话', sub: '~/.claude/projects · 按工作目录分组挑选' },
    { choice: { type: 'cli', cli: 'codex' }, icon: <Terminal size={15} />, title: '导入 Codex 会话', sub: '~/.codex · 按工作目录分组挑选' },
    { choice: { type: 'cli', cli: 'coco' }, icon: <Terminal size={15} />, title: '导入 Coco 会话', sub: '~/Library/Caches/coco · 按工作目录分组挑选' },
    { choice: { type: 'path' }, icon: <FolderInput size={15} />, title: '选择导入路径', sub: '挑一个目录，导入该目录下的会话' },
    { choice: { type: 'id' }, icon: <Hash size={15} />, title: '按会话 ID 导入', sub: '粘贴 session id 直接导入' },
  ]
  return (
    <Dialog open onClose={onCancel} width={420}>
      <div className="flex flex-col">
        <div className="border-b border-border px-4 py-3">
          <div className="text-[13px] font-semibold text-foreground">导入会话</div>
          <div className="mt-0.5 text-[11px] text-text-dim">选择导入方式</div>
        </div>
        <div className="flex flex-col gap-1 p-2">
          {entries.map((e, i) => (
            <button
              key={i}
              onClick={() => onPick(e.choice)}
              className="flex items-center gap-3 rounded-md border border-transparent px-3 py-2.5 text-left hover:border-brand/40 hover:bg-brand/5"
            >
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-md border border-border bg-card text-muted-foreground">{e.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-medium text-foreground">{e.title}</span>
                <span className="block truncate text-[11px] text-text-dim">{e.sub}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  )
}
