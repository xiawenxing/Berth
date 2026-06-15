import type { DataSourceAdapter, AdapterContext, AdapterAvailability } from './adapter'
import type { DataSourceRow, NormalizedRecord, Task, TaskFields } from '../types'

/**
 * Meego (飞书项目 / Meegle) data-source adapter — STUB.
 *
 * Implements the DataSourceAdapter seam so Meego can be wired in later as a config-only exercise.
 * To implement, map Berth's canonical fields onto Meego work-item fields via the source config
 * (config.config_json), e.g.:
 *   - config.projectKey         → Meego project key / space id
 *   - config.workItemType       → which work-item type tasks map to (需求/任务/缺陷)
 *   - config.statusMap          → { '待办': <meego state>, '进行中': …, '已完成': … }
 *   - config.priorityMap        → { 'P0': …, 'P1': … }
 *   - config.fieldMap           → { title, detailDoc, progress } → Meego field keys
 * Pull via Meego's work-item query API; push via create/update work-item. Use the `meegle` skill
 * / meego-openapp MCP as the transport. detailDoc is an internal ref; translate to a Meego-friendly
 * representation (link or text) here, never in the core.
 */
export class MeegoAdapter implements DataSourceAdapter {
  readonly kind = 'meego'

  async checkAvailable(): Promise<AdapterAvailability> {
    return { available: false, reason: 'Meego adapter is not implemented yet.' }
  }

  async pullTasks(_src: DataSourceRow, _ctx: AdapterContext): Promise<NormalizedRecord[]> {
    throw new Error('meego adapter not implemented')
  }
  async createTask(_src: DataSourceRow, _task: Task, _ctx: AdapterContext): Promise<string> {
    throw new Error('meego adapter not implemented')
  }
  async updateTask(_src: DataSourceRow, _externalId: string, _patch: Partial<TaskFields>, _ctx: AdapterContext): Promise<void> {
    throw new Error('meego adapter not implemented')
  }
  async deleteTask(_src: DataSourceRow, _externalId: string, _ctx: AdapterContext): Promise<void> {
    throw new Error('meego adapter not implemented')
  }
}
