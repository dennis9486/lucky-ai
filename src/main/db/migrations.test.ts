import { describe, expect, it } from 'vitest'
import { CURRENT_SCHEMA_VERSION, MIGRATIONS } from './migrations.js'

describe('database migrations', () => {
  it('keeps scheduled task columns aligned with the task service', () => {
    const scheduledTaskSql = Object.values(MIGRATIONS)
      .flat()
      .filter((sql) => sql.includes('scheduled_tasks'))
      .join('\n')

    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(11)
    expect(scheduledTaskSql).toContain('run_mode')
    expect(scheduledTaskSql).toContain('pending_run_at')
    expect(scheduledTaskSql).toContain('remind_at')
    expect(scheduledTaskSql).toContain('last_run_status')
  })
})
