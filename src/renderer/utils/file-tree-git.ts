import type { WorkspaceGitFileStatus } from '../../shared/types/workspace.js'

export type FileTreeGitTone = 'added' | 'modified' | 'renamed' | 'deleted'

export interface FileTreeGitDecoration {
  code: string
  tone: FileTreeGitTone
}

export function getGitStatusCode(file: WorkspaceGitFileStatus): string {
  if (file.index === '?' || file.workingTree === '?') return 'U'
  if (file.index !== ' ' && file.workingTree !== ' ') return `${file.index}${file.workingTree}`.trim()
  return (file.workingTree !== ' ' ? file.workingTree : file.index).trim() || 'M'
}

export function getGitStatusTone(code: string): FileTreeGitTone {
  if (code.includes('D')) return 'deleted'
  if (code.includes('A') || code.includes('U')) return 'added'
  if (code.includes('R')) return 'renamed'
  return 'modified'
}

export function buildGitTreeDecorations(files: WorkspaceGitFileStatus[] | undefined): {
  fileDecorations: Map<string, FileTreeGitDecoration>
  dirtyFolders: Set<string>
} {
  const fileDecorations = new Map<string, FileTreeGitDecoration>()
  const dirtyFolders = new Set<string>()

  for (const file of files ?? []) {
    const code = getGitStatusCode(file)
    fileDecorations.set(file.path, { code, tone: getGitStatusTone(code) })

    const parts = file.path.split('/').filter(Boolean)
    for (let index = 1; index < parts.length; index += 1) {
      dirtyFolders.add(parts.slice(0, index).join('/'))
    }
  }

  return { fileDecorations, dirtyFolders }
}
