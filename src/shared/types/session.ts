import type { ChatMessage } from './ai.js'

export interface ChatSession {
  id: string
  title: string
  workspaceName: string
  workspacePath?: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

export interface SidebarChatItem {
  id: string
  title: string
  shortcut?: string
  timeAgo?: string
  archived?: boolean
}

export interface SidebarProjectGroup {
  id: string
  name: string
  workspacePath?: string | null
  items: SidebarChatItem[]
}
