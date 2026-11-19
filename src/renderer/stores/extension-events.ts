import { ref } from 'vue'

/**
 * 扩展列表变更信号（跨组件轻量同步）。
 * 详情页/面板等处安装、卸载后 bump 一次；已安装列表所在处 watch 它并重新拉取，
 * 避免为此单独引入一个完整 store。
 */
export const extensionsRevision = ref(0)

export function notifyExtensionsChanged(): void {
  extensionsRevision.value++
}
