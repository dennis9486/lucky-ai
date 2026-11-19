import { describe, expect, it, vi } from 'vitest'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import {
  installIpcSenderGuard,
  isTrustedFrameUrl,
  isTrustedIpcSender,
  resolveDevRendererOrigin
} from './ipc-sender-guard.js'

interface FakeEventOptions {
  senderType?: string
  frameUrl?: string
  /** false 时 senderFrame 是与 mainFrame 不同的对象（模拟 iframe 调用） */
  fromMainFrame?: boolean
  /** true 时 senderFrame 为 null（frame 已销毁） */
  frameGone?: boolean
}

function fakeEvent(options: FakeEventOptions = {}): IpcMainInvokeEvent {
  const url = options.frameUrl ?? 'file:///app/out/renderer/index.html'
  const mainFrame = { url }
  const senderFrame = options.frameGone
    ? null
    : options.fromMainFrame === false
      ? { url }
      : mainFrame
  return {
    sender: { getType: () => options.senderType ?? 'window', mainFrame },
    senderFrame
  } as unknown as IpcMainInvokeEvent
}

describe('ipc sender guard', () => {
  it('resolves dev renderer origin, tolerating missing or invalid url', () => {
    expect(resolveDevRendererOrigin('http://localhost:5173/')).toBe('http://localhost:5173')
    expect(resolveDevRendererOrigin(undefined)).toBeNull()
    expect(resolveDevRendererOrigin('not-a-url')).toBeNull()
  })

  it('trusts file: urls and the dev origin only', () => {
    expect(isTrustedFrameUrl('file:///app/out/renderer/index.html', null)).toBe(true)
    expect(isTrustedFrameUrl('http://localhost:5173/index.html', 'http://localhost:5173')).toBe(true)
    expect(isTrustedFrameUrl('http://localhost:5173/index.html', null)).toBe(false)
    expect(isTrustedFrameUrl('https://evil.example/x', 'http://localhost:5173')).toBe(false)
    expect(isTrustedFrameUrl('', null)).toBe(false)
  })

  it('accepts the app window main frame', () => {
    expect(isTrustedIpcSender(fakeEvent(), null)).toBe(true)
  })

  it('rejects webview senders, sub frames, and destroyed frames', () => {
    expect(isTrustedIpcSender(fakeEvent({ senderType: 'webview' }), null)).toBe(false)
    expect(isTrustedIpcSender(fakeEvent({ fromMainFrame: false }), null)).toBe(false)
    expect(isTrustedIpcSender(fakeEvent({ frameGone: true }), null)).toBe(false)
  })

  it('wraps ipcMain.handle: untrusted calls short-circuit into an IpcResult failure', async () => {
    const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
    const ipc = {
      handle: (channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
        handlers.set(channel, listener)
      }
    } as unknown as IpcMain

    installIpcSenderGuard(ipc)
    const listener = vi.fn().mockResolvedValue({ success: true, data: 42 })
    ipc.handle('demo:channel', listener)
    const wrapped = handlers.get('demo:channel')!

    await expect(wrapped(fakeEvent(), 'arg')).resolves.toEqual({ success: true, data: 42 })
    expect(listener).toHaveBeenCalledWith(expect.anything(), 'arg')

    const blocked = wrapped(fakeEvent({ senderType: 'webview' }))
    expect(blocked).toEqual({ success: false, error: expect.stringContaining('不受信任') })
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
