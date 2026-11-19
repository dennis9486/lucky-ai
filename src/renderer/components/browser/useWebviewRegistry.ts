import type { Ref } from 'vue'
import type { WebviewEl } from './browser-model.js'

export interface WebviewRegistryLogger {
  debug: (message: string, detail?: unknown) => void
}

export function useWebviewRegistry(activeTabId: Ref<string>, logger?: WebviewRegistryLogger) {
  const webviewRefs = new Map<string, WebviewEl>()
  const pendingLoads = new Map<string, string>()

  function setWebviewRef(tabId: string, element: unknown): void {
    if (!isWebviewElement(element)) {
      webviewRefs.delete(tabId)
      return
    }
    webviewRefs.set(tabId, element)
    logger?.debug('webview ref attached', { tabId })
  }

  function webviewFor(tabId: string): WebviewEl | null {
    return webviewRefs.get(tabId) ?? null
  }

  function activeWebview(): WebviewEl | null {
    return webviewFor(activeTabId.value)
  }

  function queueLoad(tabId: string, url: string): void {
    pendingLoads.set(tabId, url)
  }

  function takeQueuedLoad(tabId: string): string | null {
    const url = pendingLoads.get(tabId) ?? null
    if (url) pendingLoads.delete(tabId)
    return url
  }

  function forgetTab(tabId: string): void {
    webviewRefs.delete(tabId)
    pendingLoads.delete(tabId)
  }

  return {
    setWebviewRef,
    webviewFor,
    activeWebview,
    queueLoad,
    takeQueuedLoad,
    forgetTab
  }
}

function isWebviewElement(value: unknown): value is WebviewEl {
  return Boolean(value && typeof value === 'object' && 'loadURL' in value)
}

