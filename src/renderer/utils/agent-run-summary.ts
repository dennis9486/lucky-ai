import type { AgentRunSummary, MessagePart, ToolCallPart } from '../../shared/types/ai.js'

const TEST_COMMAND_RE = /\b(test|vitest|jest|pytest|go test|cargo test|mvn test|gradle test|type-check|tsc|lint|build)\b/i

export function buildAgentRunSummary(parts: MessagePart[]): AgentRunSummary {
  const tools = parts.filter((part): part is ToolCallPart => part.type === 'tool')
  const failed = tools.filter((tool) => tool.status === 'error')
  return {
    toolCount: tools.length,
    failedToolCount: failed.length,
    changedFiles: unique(tools.map(getMutatedPath).filter(Boolean)),
    verificationCommands: tools
      .filter((tool) => tool.name === 'Bash')
      .map((tool) => ({ command: stringInput(tool.input?.command), status: tool.status }))
      .filter((item) => TEST_COMMAND_RE.test(item.command)),
    failureReasons: unique(failed.map((tool) => tool.errorSummary || firstUsefulLine(tool.output)).filter(Boolean))
  }
}

function getMutatedPath(tool: ToolCallPart): string {
  if (!['Write', 'Edit', 'MultiEdit'].includes(tool.name)) return ''
  const input = tool.input ?? {}
  return (
    stringInput(input.file_path)
    || stringInput(input.path)
    || stringInput(input.target_path)
    || stringInput(input.absolute_path)
  )
}

function stringInput(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function firstUsefulLine(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /error|failed|exception|denied|not found|no such|permission|timeout/i.test(line))
    ?? ''
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}
