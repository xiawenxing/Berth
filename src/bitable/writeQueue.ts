export interface Job { key: string; payload: unknown }
export interface WriteQueueOpts { spacingMs: number; run: (job: Job) => Promise<void> }

/** Single in-flight writer, >=spacingMs between writes, idempotency-keyed. */
export class WriteQueue {
  private q: Job[] = []
  private seen = new Set<string>()
  private running = false
  onError: (e: unknown) => void = () => {}
  constructor(private opts: WriteQueueOpts) {}

  enqueue(job: Job) {
    if (this.seen.has(job.key)) return
    this.seen.add(job.key); this.q.push(job)
    void this.pump()
  }
  private async pump() {
    if (this.running) return
    this.running = true
    while (this.q.length) {
      const job = this.q.shift()!
      try { await this.opts.run(job) } catch (e) { this.onError(e) }
      if (this.q.length) await sleep(this.opts.spacingMs)
    }
    this.running = false
  }
  async drain() { while (this.running || this.q.length) await sleep(this.opts.spacingMs) }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
