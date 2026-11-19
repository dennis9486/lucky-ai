import type { Tool } from '@agentscope-ai/agentscope/tool'
import type {
  CreateScheduledTaskInput,
  ScheduledTaskCadence,
  ScheduledTaskRunMode
} from '../../../shared/types/scheduled-task.js'
import { createLogger } from '../../../shared/utils/log.js'
import { securityService } from '../../services/security.service.js'
import { scheduledTaskService } from '../../services/scheduled-task.service.js'

const logger = createLogger('main/agentscope-tools/scheduled-task')

function asScheduledCadence(value: unknown): ScheduledTaskCadence {
  return ['once', 'daily', 'weekly', 'workdays', 'monthly', 'custom'].includes(String(value))
    ? String(value) as ScheduledTaskCadence
    : 'custom'
}

function asScheduledRunMode(value: unknown): ScheduledTaskRunMode {
  return value === 'auto' ? 'auto' : 'notify'
}

export function createListScheduledTasksTool(requireUserConfirm: boolean): Tool {
  return {
    name: 'ListScheduledTasks',
    description: `List Lucky's in-app scheduled tasks.
Use this before creating a new scheduled task when you need to check existing tasks or avoid duplicates.
Input: { "query"?: string, "status"?: "active"|"paused"|"archived"|"all" }.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional search text for title, prompt, or project' },
        status: { type: 'string', enum: ['active', 'paused', 'archived', 'all'], description: 'Task status filter' }
      }
    },
    requireUserConfirm,
    async call(input: { query?: string; status?: 'active' | 'paused' | 'archived' | 'all' } = {}): Promise<string> {
      securityService.assertAgentToolAllowed('ListScheduledTasks', input as Record<string, unknown>)
      const tasks = scheduledTaskService.list({
        query: input.query ? String(input.query) : undefined,
        status: input.status ?? 'all'
      })
      return JSON.stringify({ tasks }, null, 2)
    }
  }
}

export function createScheduledTaskTool(requireUserConfirm: boolean): Tool {
  return {
    name: 'CreateScheduledTask',
    description: `Create a Lucky in-app scheduled task. Use this when the user asks to create, schedule, automate, remind, monitor, or run a recurring task through chat.
Do NOT create launchd/crontab files, shell scripts, or workspace files for this purpose unless the user explicitly asks for system-level automation.
For Chinese requests like "工作日 北京时间 6点", use cadence="workdays", timezone="Asia/Shanghai", schedule_text="06:00".
Input: {
  "title": string,
  "prompt": string,
  "cadence"?: "once"|"daily"|"weekly"|"workdays"|"monthly"|"custom",
  "schedule_text"?: string,
  "timezone"?: string,
  "project_name"?: string|null,
  "run_mode"?: "notify"|"auto"
}.`,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short task name shown in the Scheduled page' },
        prompt: { type: 'string', description: 'The full instruction to run when the task fires' },
        cadence: { type: 'string', enum: ['once', 'daily', 'weekly', 'workdays', 'monthly', 'custom'] },
        schedule_text: { type: 'string', description: 'Human-readable schedule or HH:mm, e.g. 06:00, 工作日 06:00, 周五 09:00' },
        timezone: { type: 'string', description: 'IANA timezone, e.g. Asia/Shanghai, America/New_York' },
        project_name: { type: ['string', 'null'], description: 'Optional Lucky project name' },
        run_mode: { type: 'string', enum: ['notify', 'auto'], description: 'notify requires user confirmation when due; auto runs automatically' }
      },
      required: ['title', 'prompt']
    },
    requireUserConfirm,
    async call(input: {
      title: string
      prompt: string
      cadence?: ScheduledTaskCadence
      schedule_text?: string
      timezone?: string
      project_name?: string | null
      run_mode?: ScheduledTaskRunMode
    }): Promise<string> {
      securityService.assertAgentToolAllowed('CreateScheduledTask', input as Record<string, unknown>)
      const title = String(input.title ?? '').trim()
      const prompt = String(input.prompt ?? '').trim()
      if (!title) throw new Error('创建任务失败：任务标题不能为空')
      if (!prompt) throw new Error('创建任务失败：任务内容不能为空')
      const payload: CreateScheduledTaskInput = {
        title,
        prompt,
        cadence: asScheduledCadence(input.cadence),
        scheduleText: String(input.schedule_text ?? '').trim(),
        timezone: input.timezone ? String(input.timezone).trim() : undefined,
        projectName: input.project_name == null ? null : String(input.project_name).trim(),
        runMode: asScheduledRunMode(input.run_mode),
        source: 'chat'
      }
      const task = scheduledTaskService.create(payload)
      logger.info('scheduled task created by agent tool', {
        id: task.id,
        title: task.title,
        cadence: task.cadence,
        runMode: task.runMode,
        projectName: task.projectName
      })
      return JSON.stringify({ created: true, task }, null, 2)
    }
  }
}

