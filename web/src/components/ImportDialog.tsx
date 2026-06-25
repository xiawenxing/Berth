import { useMemo, useState } from 'react'
import { Dialog } from '@/components/ui/Overlay'
import { SessionPickRow } from '@/components/SessionPickRow'
import { useShowMore } from '@/lib/paging'
import { ShowMoreToggle } from '@/components/ui/ShowMoreToggle'
import type { PreviewSession } from '@/lib/api'

/**
 * Pick-which-sessions-to-import dialog. Shared by three entry points:
 *  - 'register' (货舱「添加目录」): registering the dir is the primary action, import is optional —
 *    confirm with 0 selected still registers ("仅登记目录"); with N → "登记并导入 (N)".
 *  - 'import' (a cwd group's import icon, or 无归属导入): pure import, disabled at 0.
 *
 * Sessions arrive pre-sorted (updatedAt desc) and uncapped; we paginate client-side (8 + Show more).
 * Default selection is EMPTY (the list can be huge — never auto-select). 全选 covers the FULL set,
 * including not-yet-rendered rows. The dialog is pure UI: it hands the selected ids back; the caller
 * runs the actual addPath / importSessions calls so each entry composes its own semantics.
 */
export function ImportDialog({
  path,
  sessions,
  mode,
  busy,
  onCancel,
  onConfirm,
  registerOption,
}: {
  path: string
  sessions: PreviewSession[]
  mode: 'register' | 'import'
  busy: boolean
  onCancel: () => void
  // alsoRegister carries the optional 「同时登记为装载目录」 choice (only when `registerOption` is set).
  onConfirm: (ids: string[], alsoRegister?: boolean) => void
  // 'import' mode only: when true, render a 「同时登记为装载目录」 checkbox (default off, §10.3).
  registerOption?: boolean
}) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set()) // default: none
  const [register, setRegister] = useState(false) // 同时登记为装载目录 (opt-in, §10.3)
  const { visibleCount, hidden, paginated, canCollapse, loadMore, collapse } = useShowMore(sessions.length)
  const allIds = useMemo(() => sessions.map((s) => s.sessionId), [sessions])
  const allOn = sessions.length > 0 && checked.size === sessions.length
  const visible = sessions.slice(0, visibleCount)

  const toggleOne = (id: string) =>
    setChecked((s) => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  const toggleAll = () => setChecked(allOn ? new Set() : new Set(allIds)) // 全选 over the FULL set

  const n = checked.size
  const confirmLabel =
    mode === 'register'
      ? busy
        ? '处理中…'
        : n === 0
          ? '仅登记目录'
          : `登记并导入 (${n})`
      : busy
        ? '导入中…'
        : `导入选中 (${n})`
  const confirmDisabled = busy || (mode === 'import' && n === 0)

  return (
    <Dialog open onClose={busy ? () => {} : onCancel} width={520}>
      <div className="flex flex-col">
        <div className="border-b border-border px-4 py-3">
          <div className="text-[13px] font-semibold text-foreground">
            {mode === 'register' ? '登记目录到项目货舱' : '导入会话'}
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-text-dim">{path}</div>
          {mode === 'register' && (
            <div className="mt-1.5 rounded-md border border-brand/25 bg-brand/5 px-2 py-1 text-[11px] text-muted-foreground">
              添加目录会把它登记为项目货舱。下面是<b>可选</b>导入已有会话——默认不导入，直接「仅登记目录」即可。
            </div>
          )}
        </div>

        {sessions.length === 0 ? (
          <div className="px-4 py-6 text-[12px] text-muted-foreground">
            {mode === 'register' ? '该目录下没有会话，仅登记为货舱目录。' : '该目录下没有可导入的会话。'}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-4 pt-2.5">
              <span className="text-[11px] text-text-dim">
                在该目录下找到 {sessions.length} 个会话 · 已选 <b className="text-brand">{n}</b>
              </span>
              <button className="text-[11px] text-brand hover:underline" onClick={toggleAll}>
                {allOn ? '全不选' : '全选（含未展开）'}
              </button>
            </div>
            <div className="max-h-[44vh] overflow-y-auto px-4 py-2">
              <div className="flex flex-col gap-1">
                {visible.map((s) => (
                  <SessionPickRow
                    key={s.sessionId}
                    session={s}
                    checked={checked.has(s.sessionId)}
                    onToggle={() => toggleOne(s.sessionId)}
                  />
                ))}
                {paginated && (
                  <ShowMoreToggle
                    hidden={hidden}
                    total={sessions.length}
                    canCollapse={canCollapse}
                    onMore={loadMore}
                    onCollapse={collapse}
                    showTotal
                    className="mt-1 px-1 py-1"
                  />
                )}
              </div>
            </div>
          </>
        )}

        <div className="flex items-center gap-2 border-t border-border px-4 py-3">
          {registerOption && mode === 'import' && (
            <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-muted-foreground select-none">
              <input
                type="checkbox"
                checked={register}
                onChange={(e) => setRegister(e.target.checked)}
                disabled={busy}
                className="h-3.5 w-3.5 accent-brand"
              />
              同时登记为装载目录
            </label>
          )}
          <span className="flex-1" />
          <button
            className="rounded-md px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-50"
            onClick={onCancel}
            disabled={busy}
          >
            取消
          </button>
          <button
            className="rounded-md bg-brand px-3 py-1.5 text-[12px] font-medium text-brand-foreground hover:bg-brand/90 disabled:opacity-50"
            onClick={() => onConfirm([...checked], register)}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
