import type { ChatModelBase } from '@agentscope-ai/agentscope/model'

/**
 * abort-signal.ts — 按会话把中止信号穿透到模型 HTTP 层。
 *
 * 背景：abort 原来只设标志位，事件循环在「下一个事件到达时」才退出——
 * 在途的模型流式请求会继续跑到 SDK 默认超时（openai 为 10 分钟）。
 * 本模块让「用户点停止」真正取消底层请求：
 *
 * - 注册表：agent-manager 在每轮开始时登记该会话的 AbortSignal，结束时清除；
 *   模型包装器在发请求时读取（模型实例与会话同生命周期，轮次信号必须动态取）。
 * - openai/lmstudio：包装 client.chat.completions.create，把 signal 作为
 *   openai SDK 的请求选项传入（SDK 原生支持，中止抛 APIUserAbortError）。
 * - ollama：ollama-js 不支持每请求 signal，包装 model.call 在 signal 触发时
 *   调 client.abort()（中止该 client 的在途流式请求）。
 * - anthropic（自实现）：fetch 直接挂 signal（见 anthropic-model.ts）。
 */

const signals = new Map<string, AbortSignal>()

/** 登记某会话当前轮的中止信号（每轮一个新 controller，旧信号被覆盖） */
export function setTurnAbortSignal(conversationKey: string, signal: AbortSignal): void {
  signals.set(conversationKey, signal)
}

/** 清除该轮信号；仅当仍是同一个 signal 时才清（防止并发下新轮被旧轮的 finally 清掉） */
export function clearTurnAbortSignal(conversationKey: string, signal: AbortSignal): void {
  if (signals.get(conversationKey) === signal) signals.delete(conversationKey)
}

export function getTurnAbortSignal(conversationKey: string): AbortSignal | undefined {
  return signals.get(conversationKey)
}

interface CompletionsHost {
  client?: {
    chat?: {
      completions?: {
        create?: (...args: unknown[]) => Promise<unknown>
      }
    }
  }
}

/**
 * openai/lmstudio 路径：把当前轮的 signal 注入 openai SDK 的请求选项。
 * 与 withReasoningRoundTrip 同一挂点（completions.create），可叠加包装。
 */
export function withRequestAbortSignal<T extends ChatModelBase>(
  model: T,
  getSignal: () => AbortSignal | undefined
): T {
  const completions = (model as unknown as CompletionsHost).client?.chat?.completions
  const original = completions?.create
  if (!completions || typeof original !== 'function') return model

  const boundOriginal = original.bind(completions) as (...args: unknown[]) => Promise<unknown>
  completions.create = (...args: unknown[]): Promise<unknown> => {
    const signal = getSignal()
    if (!signal) return boundOriginal(...args)
    const options = { ...(args[1] as Record<string, unknown> | undefined), signal }
    return boundOriginal(args[0], options, ...args.slice(2))
  }
  return model
}

interface AbortableClientHost {
  client?: { abort?: () => void }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(value) && typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function'
}

/**
 * ollama 路径：signal 触发时调用 client.abort() 中止在途流式请求。
 * 监听器活到流消费结束（流式响应期间中止也要能断流）。
 */
export function withClientAbort<T extends ChatModelBase>(
  model: T,
  getSignal: () => AbortSignal | undefined
): T {
  const target = model as unknown as { call?: (...args: unknown[]) => Promise<unknown> } & AbortableClientHost
  const originalCall = target.call?.bind(model)
  if (typeof originalCall !== 'function') return model

  target.call = async (...args: unknown[]): Promise<unknown> => {
    const signal = getSignal()
    if (!signal) return originalCall(...args)
    if (signal.aborted) throw new Error('模型调用已被中止')

    const onAbort = () => target.client?.abort?.()
    signal.addEventListener('abort', onAbort, { once: true })
    const release = () => signal.removeEventListener('abort', onAbort)

    try {
      const result = await originalCall(...args)
      if (isAsyncIterable(result)) {
        return (async function* () {
          try {
            yield* result
          } finally {
            release()
          }
        })()
      }
      release()
      return result
    } catch (error) {
      release()
      throw error
    }
  }
  return model
}
