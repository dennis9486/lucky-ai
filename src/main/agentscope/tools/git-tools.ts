import type { Tool } from '@agentscope-ai/agentscope/tool'
import { securityService } from '../../services/security.service.js'
import { workspaceService } from '../../services/workspace.service.js'

/** 工作区 Git 只读观察工具群 */

export function createGitStatusTool(requireUserConfirm: boolean): Tool {
  return {
    name: 'GitStatus',
    description: 'Read the current Git branch, upstream, ahead/behind counts, and changed files. Use before and after edits.',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    requireUserConfirm,
    async call(): Promise<string> {
      securityService.assertAgentToolAllowed('GitStatus', {})
      return JSON.stringify(await workspaceService.getGitStatus(), null, 2)
    }
  }
}

export function createGitDiffSummaryTool(requireUserConfirm: boolean): Tool {
  return {
    name: 'GitDiffSummary',
    description: 'Return a concise text summary of the current workspace Git diff for final review. This is read-only.',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    requireUserConfirm,
    async call(): Promise<string> {
      securityService.assertAgentToolAllowed('GitDiffSummary', {})
      return workspaceService.getGitDiffSummary()
    }
  }
}

export function createGitFileHunksTool(requireUserConfirm: boolean): Tool {
  return {
    name: 'GitFileHunks',
    description: 'Return structured unified-diff hunks for one changed file. Input: { "path": string }.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Changed file path relative to the workspace root' }
      },
      required: ['path']
    },
    requireUserConfirm,
    async call(input: { path: string }): Promise<string> {
      securityService.assertAgentToolAllowed('GitFileHunks', input as Record<string, unknown>)
      return JSON.stringify(await workspaceService.getGitFileHunks(String(input.path ?? '')), null, 2)
    }
  }
}
