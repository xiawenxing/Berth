export function Unassigned() {
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="sticky top-0 z-10 border-b border-border bg-background px-6 py-4">
        <h1 className="text-[17px] font-bold text-foreground">无归属会话</h1>
        <p className="mt-1 text-[12px] text-muted-foreground">不属于任何项目的会话 · 可归属或导入</p>
      </header>
      <div className="px-6 py-5 text-[12px] text-text-dim">（占位 — 按 v7-unassigned.html 填充）</div>
    </div>
  )
}
