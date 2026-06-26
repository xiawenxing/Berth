import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Dialog } from '@/components/ui/Overlay'
import { SessionPickRow } from '@/components/SessionPickRow'
import { api, type PreviewSession } from '@/lib/api'

/** Split pasted text into ids on whitespace / comma / newline; drop blanks. */
export function parseIds(text: string): string[] {
  return text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
}

/**
 * Import-by-session-id dialog. Paste one or more ids → look them up across all CLI stores
 * (preview-by-ids) → confirm which found sessions to import, with a warning listing any not-found ids.
 * The actual import is delegated to the caller via `onImport` (which also marks them read + resyncs).
 */
export function ImportByIdDialog({ busy, onCancel, onImport }: { busy: boolean; onCancel: () => void; onImport: (ids: string[]) => Promise<void> }) {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<{ found: PreviewSession[]; notFound: string[] } | null>(null)
  const [checked, setChecked] = useState<Set<string>>(() => new Set())
  const [looking, setLooking] = useState(false)
  const lock = busy || looking

  const ids = parseIds(text)

  const doLookup = async () => {
    if (lock || ids.length === 0) return
    setLooking(true)
    try {
      const res = await api.previewByIds(ids)
      setPreview(res)
      setChecked(new Set(res.found.map((s) => s.sessionId))) // default: import all found
    } catch {
      setPreview({ found: [], notFound: ids })
    } finally {
      setLooking(false)
    }
  }

  const toggleOne = (id: string) =>
    setChecked((s) => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const doImport = async () => {
    if (lock || checked.size === 0) return
    await onImport([...checked])
  }

  const n = checked.size

  return (
    <Dialog open onClose={lock ? () => {} : onCancel} width={520}>
      <div className="flex flex-col">
        <div className="border-b border-border px-4 py-3">
          <div className="text-[13px] font-semibold text-foreground">按会话 ID 导入</div>
          <div className="mt-0.5 text-[11px] text-text-dim">粘贴一个或多个 session id（空格 / 逗号 / 换行分隔）</div>
        </div>

        <div className="px-4 py-3">
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setPreview(null) }}
            placeholder="例如：019ecf8b-0151-7151-9db6-97fe3d3f377b"
            rows={3}
            className="w-full resize-y rounded-md border border-border bg-card px-2.5 py-1.5 font-mono text-[11.5px] text-foreground outline-none placeholder:text-text-dim focus:border-brand"
          />

          {preview && (
            <div className="mt-3">
              {preview.notFound.length > 0 && (
                <div className="mb-2 flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                  <AlertTriangle size={13} className="mt-px flex-none" />
                  <div className="min-w-0">
                    <div>{preview.notFound.length} 个 id 在本地会话库中未找到（无法导入）：</div>
                    <div className="mt-0.5 break-all font-mono text-[10.5px] opacity-80">{preview.notFound.join('  ')}</div>
                  </div>
                </div>
              )}
              {preview.found.length > 0 ? (
                <>
                  <div className="mb-1 text-[11px] text-text-dim">找到 {preview.found.length} 个会话 · 已选 <b className="text-brand">{n}</b></div>
                  <div className="flex max-h-[34vh] flex-col gap-1 overflow-y-auto">
                    {preview.found.map((s) => (
                      <SessionPickRow key={s.sessionId} session={s} checked={checked.has(s.sessionId)} onToggle={() => toggleOne(s.sessionId)} showCwd />
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-[12px] text-muted-foreground">没有可导入的会话。</div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-border px-4 py-3">
          <span className="flex-1" />
          <button className="rounded-md px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-50" onClick={onCancel} disabled={lock}>
            取消
          </button>
          {!preview ? (
            <button
              className="btn-primary rounded-md px-3 py-1.5 text-[12px] font-medium"
              onClick={doLookup}
              disabled={lock || ids.length === 0}
            >
              {looking ? '查找中…' : `查找 (${ids.length})`}
            </button>
          ) : (
            <button
              className="btn-primary rounded-md px-3 py-1.5 text-[12px] font-medium"
              onClick={doImport}
              disabled={lock || n === 0}
            >
              {busy ? '导入中…' : `导入选中 (${n})`}
            </button>
          )}
        </div>
      </div>
    </Dialog>
  )
}
