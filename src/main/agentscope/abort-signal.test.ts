import { describe, expect, it, vi } from 'vitest'
import type { ChatModelBase } from '@agentscope-ai/agentscope/model'
import {
  clearTurnAbortSignal,
  getTurnAbortSignal,
  setTurnAbortSignal,
  withClientAbort,
  withRequestAbortSignal
} from './abort-signal.js'

describe('turn abort signal registry', () => {
  it('registers, reads and clears per conversation', () => {
    const controller = new AbortController()
    setTurnAbortSignal('conv-1', controller.signal)
    expect(getTurnAbortSignal('conv-1')).toBe(controller.signal)
    expect(getTurnAbortSignal('conv-2')).toBeUndefined()

    clearTurnAbortSignal('conv-1', controller.signal)
    expect(getTurnAbortSignal('conv-1')).toBeUndefined()
  })

  it('does not let a stale turn clear the signal of a newer turn', () => {
    const oldTurn = new AbortController()
    const newTurn = new AbortController()
    setTurnAbortSignal('conv-1', oldTurn.signal)
    setTurnAbortSignal('conv-1', newTurn.signal)

    // 旧轮 finally 清理：不能把新轮刚登记的信号清掉
    clearTurnAbortSignal('conv-1', oldTurn.signal)
    expect(getTurnAbortSignal('conv-1')).toBe(newTurn.signal)
    clearTurnAbortSignal('conv-1', newTurn.signal)
  })
})

describe('withRequestAbortSignal (openai path)', () => {
  function fakeOpenAiModel() {
    const create = vi.fn().mockResolvedValue({ ok: true })
    const model = { client: { chat: { completions: { create } } } }
    return { model: model as unknown as ChatModelBase, create }
  }

  it('injects the current turn signal as an openai request option', async () => {
    const { model, create } = fakeOpenAiModel()
    const controller = new AbortController()
    withRequestAbortSignal(model, () => controller.signal)

    const completions = (model as unknown as { client: { chat: { completions: { create: (...args: unknown[]) => Promise<unknown> } } } }).client.chat.completions
    await completions.create({ messages: [] }, { timeout: 5 })

    expect(create).toHaveBeenCalledWith({ messages: [] }, { timeout: 5, signal: controller.signal })
  })

  it('passes through untouched when no turn signal is registered', async () => {
    const { model, create } = fakeOpenAiModel()
    withRequestAbortSignal(model, () => undefined)

    const completions = (model as unknown as { client: { chat: { completions: { create: (...args: unknown[]) => Promise<unknown> } } } }).client.chat.completions
    await completions.create({ messages: [] })

    expect(create).toHaveBeenCalledWith({ messages: [] })
  })

  it('leaves models without a completions client unchanged', () => {
    const bare = {} as unknown as ChatModelBase
    expect(withRequestAbortSignal(bare, () => undefined)).toBe(bare)
  })
})

describe('withClientAbort (ollama path)', () => {
  function fakeOllamaModel(chunks: string[]) {
    const abort = vi.fn()
    const model = {
      client: { abort },
      call: vi.fn().mockImplementation(async () => (async function* () {
        for (const chunk of chunks) yield chunk
      })())
    }
    return { model: model as unknown as ChatModelBase, abort }
  }

  it('aborts the client when the signal fires mid-stream and releases the listener after', async () => {
    const { model, abort } = fakeOllamaModel(['a', 'b', 'c'])
    const controller = new AbortController()
    withClientAbort(model, () => controller.signal)

    const stream = await (model as unknown as { call: () => Promise<AsyncGenerator<string>> }).call()
    const seen: string[] = []
    for await (const chunk of stream) {
      seen.push(chunk)
      if (seen.length === 1) controller.abort()
    }

    expect(abort).toHaveBeenCalledTimes(1)
    // 流结束后监听器已释放：再触发不会重复 abort
    controller.abort()
    expect(abort).toHaveBeenCalledTimes(1)
  })

  it('rejects immediately when the turn was already aborted', async () => {
    const { model } = fakeOllamaModel(['a'])
    const controller = new AbortController()
    controller.abort()
    withClientAbort(model, () => controller.signal)

    await expect(
      (model as unknown as { call: () => Promise<unknown> }).call()
    ).rejects.toThrow('中止')
  })

  it('passes through when no signal is registered', async () => {
    const { model, abort } = fakeOllamaModel(['x'])
    withClientAbort(model, () => undefined)

    const stream = await (model as unknown as { call: () => Promise<AsyncGenerator<string>> }).call()
    const seen: string[] = []
    for await (const chunk of stream) seen.push(chunk)

    expect(seen).toEqual(['x'])
    expect(abort).not.toHaveBeenCalled()
  })
})
