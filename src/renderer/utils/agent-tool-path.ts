import type { MessagePart } from '../../shared/types/ai.js'

export interface ToolCallPartLike {
  type: 'tool'
  name: string
  input?: Record<string, unknown>
}

export function stringToolInput(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function toWorkspaceRelativePath(path: string, workspaceRoot?: string | null): string {
  let normalized = path.replace(/\\/g, '/').trim()
  if (!normalized) return normalized

  const root = workspaceRoot?.replace(/\\/g, '/').replace(/\/$/, '') ?? ''
  if (root && (normalized === root || normalized.startsWith(`${root}/`))) {
    normalized = normalized === root ? '' : normalized.slice(root.length + 1)
  } else {
    normalized = normalized.replace(/^\//, '')
  }
  return normalized.replace(/^\.\/+/, '')
}

export function getToolFilePath(part: ToolCallPartLike, workspaceRoot?: string | null): string {
  const input = part.input ?? {}
  const raw = (
    stringToolInput(input.file_path)
    || stringToolInput(input.path)
    || stringToolInput(input.target_path)
    || stringToolInput(input.absolute_path)
  )
  return toWorkspaceRelativePath(raw, workspaceRoot)
}

export function isMutatingAgentTool(name: string): boolean {
  return name === 'Write' || name === 'Edit' || name === 'MultiEdit'
}

export function extractAgentEditPreview(part: ToolCallPartLike): {
  path: string
  oldText: string
  newText: string
} | null {
  if (!isMutatingAgentTool(part.name)) return null
  const path = getToolFilePath(part)
  if (!path) return null
  const input = part.input ?? {}
  if (part.name === 'Write') {
    return { path, oldText: '', newText: stringToolInput(input.content) }
  }
  if (part.name === 'Edit') {
    return {
      path,
      oldText: stringToolInput(input.old_string),
      newText: stringToolInput(input.new_string)
    }
  }
  if (part.name === 'MultiEdit') {
    const edits = Array.isArray(input.edits) ? input.edits : []
    const first = edits.find((item) => item && typeof item === 'object') as Record<string, unknown> | undefined
    if (!first) return null
    return {
      path,
      oldText: stringToolInput(first.old_string),
      newText: stringToolInput(first.new_string)
    }
  }
  return null
}

export function collectTouchedPathsFromParts(parts: MessagePart[], workspaceRoot?: string | null): string[] {
  const paths = new Set<string>()
  for (const part of parts) {
    if (part.type !== 'tool' || !isMutatingAgentTool(part.name)) continue
    const path = getToolFilePath(part, workspaceRoot)
    if (path) paths.add(path)
  }
  return [...paths]
}
