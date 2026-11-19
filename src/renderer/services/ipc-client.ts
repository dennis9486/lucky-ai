/** Renderer IPC 客户端 — 封装 window.luckyAI */
import type { IpcResult } from '../../shared/types/ipc.js'
import { tGlobal } from '../i18n/index.js'

export const ipc = window.luckyAI

export async function unwrap<T>(promise: Promise<IpcResult<T>>): Promise<T> {
  const result = await promise
  if (!result.success) {
    throw new Error(result.error ?? tGlobal('agent.ipcFailed'))
  }
  // 成功即视为成功：void 类型的处理器（如 settings.set / abort / replaceMessages）
  // 合法地返回 ok(undefined)，不应当作错误。data 可能为 undefined。
  return result.data as T
}
