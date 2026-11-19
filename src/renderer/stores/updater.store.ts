import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { UpdaterState } from '../../shared/types/updater.js'
import { ipc, unwrap } from '../services/ipc-client.js'
import { createLogger } from '../../shared/utils/log.js'

const logger = createLogger('renderer/updater-store')

/**
 * 用户已“稍后”关闭的横幅标识（phase:version）。按「阶段+版本」记忆，
 * 这样关掉“有可用更新”的提示不会连带屏蔽随后“已下载、可重启”的关键提示。
 */
const dismissedKey = ref<string | null>(null)

export const useUpdaterStore = defineStore('updater', () => {
  const state = ref<UpdaterState>({ phase: 'idle', currentVersion: '', autoDownload: true })
  const checking = ref(false)
  let unsubscribe: (() => void) | null = null
  let initialized = false

  const phase = computed(() => state.value.phase)
  const isAvailable = computed(() => phase.value === 'available' || phase.value === 'downloading')
  const isDownloaded = computed(() => phase.value === 'downloaded')
  const progressPercent = computed(() => state.value.progress?.percent ?? 0)

  const bannerKey = computed(() => `${state.value.phase}:${state.value.version ?? ''}`)

  /** 是否应展示横幅：有可下载/已下载更新，且当前「阶段+版本」未被用户忽略 */
  const showBanner = computed(() => {
    if (!isAvailable.value && !isDownloaded.value) return false
    return bannerKey.value !== dismissedKey.value
  })

  async function init(): Promise<void> {
    if (initialized) return
    initialized = true
    unsubscribe = ipc.updater.onStatus((next: UpdaterState) => { state.value = next })
    try {
      state.value = await unwrap<UpdaterState>(ipc.updater.getState())
    } catch (error) {
      logger.debug('updater getState failed', { error })
    }
  }

  function dispose(): void {
    unsubscribe?.()
    unsubscribe = null
    initialized = false
  }

  async function check(): Promise<void> {
    if (checking.value) return
    checking.value = true
    try {
      state.value = await unwrap<UpdaterState>(ipc.updater.check())
    } catch (error) {
      logger.debug('updater check failed', { error })
    } finally {
      checking.value = false
    }
  }

  async function download(): Promise<void> {
    try {
      state.value = await unwrap<UpdaterState>(ipc.updater.download())
    } catch (error) {
      logger.debug('updater download failed', { error })
    }
  }

  async function install(): Promise<void> {
    await ipc.updater.install().catch((error: unknown) => logger.debug('updater install failed', { error }))
  }

  function dismiss(): void {
    dismissedKey.value = bannerKey.value
  }

  return {
    state,
    phase,
    checking,
    isAvailable,
    isDownloaded,
    progressPercent,
    showBanner,
    init,
    dispose,
    check,
    download,
    install,
    dismiss
  }
})
