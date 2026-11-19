/** 将 Pinia/Vue 响应式对象转为 IPC 可克隆的纯对象 */
export function toIpcPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
