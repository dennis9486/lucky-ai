import type { ChatMessage } from '../../shared/types/ai.js'
import type { ProjectEntry } from '../../shared/types/project.js'
import type {
  ConversationState,
  CreateSessionInput,
  LegacyConversationImport,
  LegacyImportResult,
  SessionDetail,
  SessionSummary,
  SessionListOptions,
  UpdateSessionInput
} from '../../shared/types/conversation.js'
import type { PersistedCodeAgentState } from '../../shared/types/code-agent.js'
import { ipc, unwrap } from './ipc-client.js'
import { toIpcPlain } from '../utils/ipc-serialize.js'

// 经 IPC 传递的对象/数组多来自 Pinia/Vue 响应式状态（Proxy），
// 必须先转为纯对象，否则 structuredClone 抛 "An object could not be cloned"。
export const conversation = {
  listSessions: (options?: SessionListOptions): Promise<SessionSummary[]> =>
    unwrap(ipc.conversation.listSessions(options)),

  searchSessions: (query: string): Promise<SessionSummary[]> =>
    unwrap(ipc.conversation.searchSessions(query)),

  getSession: (id: string): Promise<SessionDetail | null> =>
    unwrap(ipc.conversation.getSession(id)),

  createSession: (input: CreateSessionInput): Promise<SessionSummary> =>
    unwrap(ipc.conversation.createSession(toIpcPlain(input))),

  updateSession: (id: string, input: UpdateSessionInput): Promise<SessionSummary | null> =>
    unwrap(ipc.conversation.updateSession(id, toIpcPlain(input))),

  deleteSession: (id: string): Promise<boolean> =>
    unwrap(ipc.conversation.deleteSession(id)),

  replaceMessages: (sessionId: string, messages: ChatMessage[]): Promise<void> =>
    unwrap(ipc.conversation.replaceMessages(sessionId, toIpcPlain(messages))).then(() => undefined),

  appendMessage: (sessionId: string, message: ChatMessage): Promise<void> =>
    unwrap(ipc.conversation.appendMessage(sessionId, toIpcPlain(message))).then(() => undefined),

  upsertMessage: (sessionId: string, message: ChatMessage): Promise<void> =>
    unwrap(ipc.conversation.upsertMessage(sessionId, toIpcPlain(message))).then(() => undefined),

  recoverStreaming: (sessionId: string): Promise<ChatMessage[]> =>
    unwrap(ipc.conversation.recoverStreaming(sessionId)),

  listProjects: (): Promise<ProjectEntry[]> =>
    unwrap(ipc.conversation.listProjects()),

  upsertProject: (entry: ProjectEntry): Promise<ProjectEntry> =>
    unwrap(ipc.conversation.upsertProject(toIpcPlain(entry))),

  removeProject: (id: string): Promise<boolean> =>
    unwrap(ipc.conversation.removeProject(id)),

  getState: (): Promise<ConversationState> =>
    unwrap(ipc.conversation.getState()),

  setState: (partial: Partial<ConversationState>): Promise<ConversationState> =>
    unwrap(ipc.conversation.setState(toIpcPlain(partial))),

  importLegacy: (payload: LegacyConversationImport): Promise<LegacyImportResult> =>
    unwrap(ipc.conversation.importLegacy(toIpcPlain(payload))),

  getCodeAgentState: (): Promise<PersistedCodeAgentState | null> =>
    unwrap(ipc.conversation.getCodeAgentState()),

  setCodeAgentState: (state: PersistedCodeAgentState): Promise<void> =>
    unwrap(ipc.conversation.setCodeAgentState(toIpcPlain(state))).then(() => undefined)
}
