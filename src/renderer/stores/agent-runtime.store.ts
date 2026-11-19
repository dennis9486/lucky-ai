import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  AgentRuntimeContextBuildInput,
  AgentRuntimeContextBuildResult,
  AgentRuntimeQueueInput,
  AgentRuntimeQueueItem,
  AgentRuntimeQueueUpdateInput,
  AgentRuntimeSnapshot,
  AgentRuntimeToolRegistryItem
} from '../../shared/types/agent-runtime.js'
import { ipc, unwrap } from '../services/ipc-client.js'

export const useAgentRuntimeStore = defineStore('agentRuntime', () => {
  const snapshot = ref<AgentRuntimeSnapshot | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let stopSnapshotListener: (() => void) | null = null

  const queueCount = computed(() => snapshot.value?.queue.length ?? 0)
  const state = computed(() => snapshot.value?.state ?? 'idle')

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      snapshot.value = await unwrap(ipc.agentRuntime.getSnapshot())
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  function start(): void {
    if (stopSnapshotListener) return
    stopSnapshotListener = ipc.agentRuntime.onSnapshot((next: AgentRuntimeSnapshot) => {
      snapshot.value = next
    })
    void load()
  }

  function stop(): void {
    stopSnapshotListener?.()
    stopSnapshotListener = null
  }

  async function enqueue(input: AgentRuntimeQueueInput): Promise<AgentRuntimeQueueItem> {
    const item = await unwrap<AgentRuntimeQueueItem>(ipc.agentRuntime.enqueue(input))
    await load()
    return item
  }

  async function updateEvent(input: AgentRuntimeQueueUpdateInput): Promise<AgentRuntimeQueueItem | null> {
    const item = await unwrap<AgentRuntimeQueueItem | null>(ipc.agentRuntime.updateEvent(input))
    await load()
    return item
  }

  async function buildContext(input: AgentRuntimeContextBuildInput): Promise<AgentRuntimeContextBuildResult> {
    const result = await unwrap<AgentRuntimeContextBuildResult>(ipc.agentRuntime.buildContext(input))
    await load()
    return result
  }

  async function selectTools(text: string): Promise<AgentRuntimeToolRegistryItem[]> {
    return unwrap(ipc.agentRuntime.selectTools(text))
  }

  return {
    snapshot,
    loading,
    error,
    queueCount,
    state,
    load,
    start,
    stop,
    enqueue,
    updateEvent,
    buildContext,
    selectTools
  }
})
