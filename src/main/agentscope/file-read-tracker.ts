import { createHash } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'

/** 按会话记录 Agent 最近一次 Read 时的文件内容 hash，用于 Write 乐观锁。 */
const readsByConversation = new Map<string, Map<string, string>>()

export function hashFileContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export function recordFileRead(conversationKey: string, absPath: string, content: string): void {
  let map = readsByConversation.get(conversationKey)
  if (!map) {
    map = new Map()
    readsByConversation.set(conversationKey, map)
  }
  map.set(absPath, hashFileContent(content))
}

export function updateFileSnapshot(conversationKey: string, absPath: string, content: string): void {
  recordFileRead(conversationKey, absPath, content)
}

export function clearFileReads(conversationKey: string): void {
  readsByConversation.delete(conversationKey)
}

/** 覆盖已有文件前校验：必须先 Read，且磁盘内容未被外部修改。 */
export async function assertWriteAllowed(conversationKey: string, absPath: string): Promise<void> {
  try {
    await access(absPath, constants.F_OK)
  } catch {
    return
  }

  const snapshot = readsByConversation.get(conversationKey)?.get(absPath)
  if (!snapshot) {
    throw new Error(
      `Write blocked: read "${absPath}" first before overwriting an existing file.`
    )
  }

  const content = await readFile(absPath, 'utf-8')
  const current = hashFileContent(content)
  if (current !== snapshot) {
    throw new Error(
      `Write conflict: "${absPath}" changed on disk since your last Read. Re-read the file and regenerate your changes.`
    )
  }
}
