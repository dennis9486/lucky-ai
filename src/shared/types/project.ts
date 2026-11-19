export type StartupMode = 'local' | 'worktree'

export interface ProjectEntry {
  id: string
  name: string
  rootPath: string
  addedAt: number
}
