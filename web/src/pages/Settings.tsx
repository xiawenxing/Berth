export function Settings() {
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="sticky top-0 z-10 border-b border-border bg-background px-6 py-4">
        <h1 className="text-[17px] font-bold text-foreground">设置</h1>
        <p className="mt-1 text-[12px] text-muted-foreground">外观 · 港务助手 · 启动 Agents · 上下文 · 同步 · 任务字段</p>
      </header>
      <div className="px-6 py-5 text-[12px] text-text-dim">（占位 — 按 v7-settings.html 填充）</div>
    </div>
  )
}
