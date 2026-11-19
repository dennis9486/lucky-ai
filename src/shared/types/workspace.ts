export interface FileTreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileTreeNode[]
  /** 目录体积大，首次展开时再加载子节点 */
  lazy?: boolean
}

export interface WorkspaceInfo {
  rootPath: string
  name: string
  openedAt: number
}

export interface WorkspaceGitStatus {
  branch: string | null
  dirtyCount: number
  isRepository: boolean
  head?: string | null
  detached?: boolean
  upstream?: string | null
  ahead?: number
  behind?: number
  files?: WorkspaceGitFileStatus[]
}

export interface WorkspaceGitBranch {
  name: string
  current: boolean
  remote: boolean
  upstream?: string | null
  lastCommit?: string | null
}

export interface WorkspaceGitGraphLine {
  graph: string
  hash: string
  subject: string
  raw: string
}

export interface WorkspaceGitFileStatus {
  path: string
  previousPath?: string
  index: string
  workingTree: string
  /** Unmerged / conflict state (UU, AA, etc.) */
  conflicted?: boolean
}

export interface WorkspaceGitSyncResult {
  summary: string
  status: WorkspaceGitStatus
}

/** 一条 stash 记录（git stash list） */
export interface WorkspaceGitStashEntry {
  /** stash@{index} 中的序号 */
  index: number
  /** stash 描述（分支 + 消息） */
  description: string
  /** 相对时间，如 "2 hours ago" */
  relativeTime: string
}

export interface WorkspaceGitConflictFile {
  path: string
  working: string
  base: string
  ours: string
  theirs: string
  hasConflictMarkers: boolean
}

export interface WorkspaceGitFileDiff {
  path: string
  original: string
  modified: string
  status: WorkspaceGitFileStatus
  binary?: boolean
  message?: string
}

export interface WorkspaceGitDiffHunkLine {
  type: 'context' | 'add' | 'delete'
  text: string
  oldLine: number | null
  newLine: number | null
}

export interface WorkspaceGitDiffHunk {
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  additions: number
  deletions: number
  lines: WorkspaceGitDiffHunkLine[]
}

export interface WorkspaceGitFileHunks {
  path: string
  status: WorkspaceGitFileStatus
  binary?: boolean
  hunks: WorkspaceGitDiffHunk[]
}

export interface WorkspaceGitCommitResult {
  commit: string | null
  summary: string
  status: WorkspaceGitStatus
}

export interface WorkspaceGitReviewResult {
  summary: string
  generatedAt: number
  fallback: boolean
}

export interface FileSearchResult {
  path: string
  name: string
  type?: 'file' | 'directory'
  matchLine?: number
  preview?: string
}

export interface FileContentSearchOptions {
  query: string
  includes?: string
  excludes?: string
  caseSensitive?: boolean
  wholeWord?: boolean
  regex?: boolean
  maxResults?: number
}

export interface FileContentMatch {
  lineNumber: number
  lineText: string
  preview: string
  startColumn: number
  endColumn: number
}

export interface FileContentSearchResult {
  path: string
  name: string
  matches: FileContentMatch[]
}

export interface FileContentReplaceOptions extends FileContentSearchOptions {
  replacement: string
  paths?: string[]
}

export interface FileContentReplaceResult {
  filesChanged: number
  matchesReplaced: number
}

export interface OpenFileTab {
  path: string
  name: string
  content: string
  originalContent: string
  language: string
  /** Monaco model version captured at open/save; null until the editor binds. */
  pristineVersionId: number | null
  isDirty: boolean
}

export interface EditorWorkspaceTabState {
  path: string
}

export interface EditorWorkspaceState {
  version: 1
  tabs: EditorWorkspaceTabState[]
  activeTabPath: string | null
  splitEnabled: boolean
  secondaryTabPath: string | null
  splitRatio: number
  updatedAt: number
}

export interface FileDiff {
  path: string
  original: string
  modified: string
}
