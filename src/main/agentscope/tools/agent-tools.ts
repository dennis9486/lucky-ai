import type { Tool } from '@agentscope-ai/agentscope/tool'
import { securityService } from '../../services/security.service.js'
import { saveSkill } from '../learned-skills.js'
import { runSubagents } from '../subagent-runner.js'
import { runParallelTasks } from '../parallel-tasks.js'
import { getTurnAbortSignal } from '../abort-signal.js'

/** Agent 自我扩展工具群：并行子代理（只读/可写）与技能沉淀 */

export function createRunParallelTasksTool(requireUserConfirm: boolean, conversationKey?: string): Tool {
  return {
    name: 'RunParallelTasks',
    description: `Run up to 3 WRITABLE coding sub-agents in parallel, each in an isolated git worktree copy of the repository.
Use to parallelize independent code changes — e.g. "add tests for module A", "rename API in module B" — without touching the user's working tree.
Each sub-agent has Read/Write/Edit/Glob/Grep inside its own copy (no shell) and returns { task, report, diff }.
The diffs are NOT applied automatically: review each diff, then apply the ones you accept with Bash \`git apply <<'EOF' ... EOF\` (paths are relative to the repo root).
Requires the workspace to be a git repository. Tasks must be independent — do not split one coupled change across tasks.
Input: { "tasks": string[] } — each a self-contained implementation prompt.`,
    inputSchema: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          items: { type: 'string' },
          description: 'Independent implementation prompts (max 3)'
        }
      },
      required: ['tasks']
    },
    requireUserConfirm,
    async call(input: { tasks: string[] }): Promise<string> {
      securityService.assertAgentToolAllowed('RunParallelTasks', input as unknown as Record<string, unknown>)
      const tasks = Array.isArray(input.tasks) ? input.tasks.map((task) => String(task ?? '')) : []
      const results = await runParallelTasks(tasks, {
        getAbortSignal: conversationKey ? () => getTurnAbortSignal(conversationKey) : undefined
      })
      return JSON.stringify({ results }, null, 2)
    }
  }
}

export function createRunSubagentsTool(requireUserConfirm: boolean, conversationKey?: string): Tool {
  return {
    name: 'RunSubagents',
    description: `Run a main-agent coordinated team of read-only specialist sub-agents.
Use this when the work benefits from role separation, not just parallel lookup: researcher for facts, reviewer for risks, planner for sequencing, tester for verification, browser for UI/browser behavior, implementer for implementation scouting.
Each collaborator has only Read/Glob/Grep over the workspace (no writes, no shell). The tool returns a collaboration run: collaborators, status timeline, role-specific reports, and summary. Up to 4 collaborators per call.
Input: { "tasks": Array<string | { "role": "researcher"|"reviewer"|"planner"|"tester"|"browser"|"implementer"|"generalist", "title"?: string, "task": string }> }.
Prefer explicit roles for complex tasks. The main agent remains responsible for synthesis, decisions, edits, and final verification.`,
    inputSchema: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          items: {
            oneOf: [
              { type: 'string' },
              {
                type: 'object',
                properties: {
                  role: {
                    type: 'string',
                    enum: ['researcher', 'reviewer', 'planner', 'tester', 'browser', 'implementer', 'generalist']
                  },
                  title: { type: 'string' },
                  task: { type: 'string' }
                },
                required: ['task']
              }
            ]
          },
          description: 'Independent specialist prompts (max 4). Prefer role objects for non-trivial work.'
        }
      },
      required: ['tasks']
    },
    requireUserConfirm,
    async call(input: { tasks: Array<string | { role?: string; title?: string; task: string }> }): Promise<string> {
      securityService.assertAgentToolAllowed('RunSubagents', input as unknown as Record<string, unknown>)
      const tasks = Array.isArray(input.tasks)
        ? input.tasks.map((task) => (typeof task === 'string' ? task : {
          role: task.role,
          title: task.title,
          task: String(task.task ?? '')
        }))
        : []
      const collaboration = await runSubagents(tasks, {
        getAbortSignal: conversationKey ? () => getTurnAbortSignal(conversationKey) : undefined
      })
      return JSON.stringify({ collaboration }, null, 2)
    }
  }
}

export function createLearnSkillTool(requireUserConfirm: boolean): Tool {
  return {
    name: 'CreateSkill',
    description: `Save a reusable skill (procedural memory) distilled from a task you just completed.
Use after finishing a non-trivial multi-step workflow so it can be reused and refined next time — e.g. this project's build/test/deploy steps, a scaffolding recipe, or a tricky fix procedure.
Saved skills are injected into your future system context automatically, so keep them concise, generalizable, and actionable. Overwrites a skill with the same name.
Input: { "name": string, "description": string (when to use it), "content": string (the steps/commands in markdown) }.`,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short, stable skill name' },
        description: { type: 'string', description: 'When to use this skill (one line)' },
        content: { type: 'string', description: 'Reusable steps/commands in markdown' }
      },
      required: ['name', 'description', 'content']
    },
    requireUserConfirm,
    async call(input: { name: string; description: string; content: string }): Promise<string> {
      securityService.assertAgentToolAllowed('CreateSkill', input as Record<string, unknown>)
      const path = await saveSkill({
        name: String(input.name ?? ''),
        description: String(input.description ?? ''),
        content: String(input.content ?? '')
      })
      return JSON.stringify({ saved: true, path }, null, 2)
    }
  }
}
