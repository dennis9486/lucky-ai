import { describe, expect, it, afterEach } from 'vitest'
import {
  clearTurnToolExecutions,
  getSuccessfulToolReplay,
  recordSuccessfulToolReplay,
  withReplayNotice
} from './tool-idempotency.js'

describe('tool idempotency cache', () => {
  afterEach(() => {
    clearTurnToolExecutions('turn-1')
    clearTurnToolExecutions('turn-2')
  })

  it('stores and returns cached successful results per turn + toolCallId', () => {
    recordSuccessfulToolReplay('turn-1', 'call-a', 'ok')
    expect(getSuccessfulToolReplay('turn-1', 'call-a')).toBe('ok')
    expect(getSuccessfulToolReplay('turn-1', 'call-b')).toBeUndefined()
    expect(getSuccessfulToolReplay('turn-2', 'call-a')).toBeUndefined()
  })

  it('clears all entries for a turn', () => {
    recordSuccessfulToolReplay('turn-1', 'call-a', 'a')
    recordSuccessfulToolReplay('turn-1', 'call-b', 'b')
    recordSuccessfulToolReplay('turn-2', 'call-a', 'other')
    clearTurnToolExecutions('turn-1')
    expect(getSuccessfulToolReplay('turn-1', 'call-a')).toBeUndefined()
    expect(getSuccessfulToolReplay('turn-2', 'call-a')).toBe('other')
  })

  it('adds replay notice without duplicating it', () => {
    expect(withReplayNotice('done')).toContain('[Idempotent replay:')
    expect(withReplayNotice('done [Idempotent replay: x]')).toBe('done [Idempotent replay: x]')
  })
})
