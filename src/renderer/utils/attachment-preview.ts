import type { ComposerAttachment } from '../stores/ui.store.js'

/** 把本地文件路径（或已是 url 的路径）转成可用于 <img src> 的地址；持久化后无 blob 时的通用回退。 */
export function filePathToSrc(path: string): string {
  if (/^(blob:|data:|file:|https?:)/i.test(path)) return path
  return `file://${encodeURI(path).replace(/%5C/g, '/')}`
}

export function attachmentPreviewSrc(item: ComposerAttachment): string {
  if (item.previewUrl) return item.previewUrl
  return filePathToSrc(item.path)
}
