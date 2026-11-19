import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels.js'
import type { ChatMessage } from '../../shared/types/ai.js'
import type { ProjectEntry } from '../../shared/types/project.js'
import type {
  ConversationState,
  CreateSessionInput,
  LegacyConversationImport,
  SessionListOptions,
  UpdateSessionInput
} from '../../shared/types/conversation.js'
import type { PersistedCodeAgentState } from '../../shared/types/code-agent.js'
import type { IpcResult } from '../../shared/types/ipc.js'
import { conversationService } from '../services/conversation.service.js'

function ok<T>(data: T): IpcResult<T> {
  return { success: true, data }
}

function fail(error: string): IpcResult<never> {
  return { success: false, error }
}

function wrap<T>(fn: () => T): IpcResult<T> {
  try {
    return ok(fn())
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }
}

export function registerConversationIpc(): void {
  ipcMain.handle(IPC_CHANNELS.CONVERSATION_LIST_SESSIONS, (_e, options?: SessionListOptions) =>
    wrap(() => conversationService.listSessionSummaries(options))
  )

  ipcMain.handle(IPC_CHANNELS.CONVERSATION_SEARCH_SESSIONS, (_e, query: string) =>
    wrap(() => conversationService.searchSessionSummaries(query))
  )

  ipcMain.handle(IPC_CHANNELS.CONVERSATION_GET_SESSION, (_e, id: string) =>
    wrap(() => conversationService.getSessionDetail(id))
  )

  ipcMain.handle(IPC_CHANNELS.CONVERSATION_CREATE_SESSION, (_e, input: CreateSessionInput) =>
    wrap(() => conversationService.createSession(input))
  )

  ipcMain.handle(IPC_CHANNELS.CONVERSATION_UPDATE_SESSION, (_e, id: string, input: UpdateSessionInput) =>
    wrap(() => conversationService.updateSession(id, input))
  )

  ipcMain.handle(IPC_CHANNELS.CONVERSATION_DELETE_SESSION, (_e, id: string) =>
    wrap(() => conversationService.deleteSession(id))
  )

  ipcMain.handle(
    IPC_CHANNELS.CONVERSATION_REPLACE_MESSAGES,
    (_e, sessionId: string, messages: ChatMessage[]) =>
      wrap(() => {
        conversationService.replaceMessages(sessionId, messages)
        return true
      })
  )

  ipcMain.handle(IPC_CHANNELS.CONVERSATION_APPEND_MESSAGE, (_e, sessionId: string, message: ChatMessage) =>
    wrap(() => {
      conversationService.appendMessage(sessionId, message)
      return true
    })
  )

  ipcMain.handle(IPC_CHANNELS.CONVERSATION_UPSERT_MESSAGE, (_e, sessionId: string, message: ChatMessage) =>
    wrap(() => {
      conversationService.upsertMessage(sessionId, message)
      return true
    })
  )

  ipcMain.handle(IPC_CHANNELS.CONVERSATION_RECOVER_STREAMING, (_e, sessionId: string) =>
    wrap(() => conversationService.recoverInterruptedStreaming(sessionId))
  )

  ipcMain.handle(IPC_CHANNELS.CONVERSATION_LIST_PROJECTS, () =>
    wrap(() => conversationService.listProjects())
  )

  ipcMain.handle(IPC_CHANNELS.CONVERSATION_UPSERT_PROJECT, (_e, entry: ProjectEntry) =>
    wrap(() => conversationService.upsertProject(entry))
  )

  ipcMain.handle(IPC_CHANNELS.CONVERSATION_REMOVE_PROJECT, (_e, id: string) =>
    wrap(() => conversationService.removeProject(id))
  )

  ipcMain.handle(IPC_CHANNELS.CONVERSATION_GET_STATE, () =>
    wrap(() => conversationService.getState())
  )

  ipcMain.handle(IPC_CHANNELS.CONVERSATION_SET_STATE, (_e, partial: Partial<ConversationState>) =>
    wrap(() => conversationService.setState(partial))
  )

  ipcMain.handle(IPC_CHANNELS.CONVERSATION_IMPORT_LEGACY, (_e, payload: LegacyConversationImport) =>
    wrap(() => conversationService.importLegacy(payload))
  )

  ipcMain.handle(IPC_CHANNELS.CONVERSATION_GET_CODE_AGENT_STATE, () =>
    wrap(() => conversationService.getCodeAgentState())
  )

  ipcMain.handle(IPC_CHANNELS.CONVERSATION_SET_CODE_AGENT_STATE, (_e, state: PersistedCodeAgentState) =>
    wrap(() => {
      conversationService.setCodeAgentState(state)
      return true
    })
  )
}
