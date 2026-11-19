import { inflateRawSync } from 'node:zlib'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, sep } from 'node:path'

/**
 * 依赖无关的 VSIX(=ZIP) 解包器。
 *
 * VSIX 是标准 ZIP：扩展文件都在 `extension/` 前缀下（另有 `[Content_Types].xml` 等元数据）。
 * 只用 Node 内置 zlib.inflateRawSync（DEFLATE，method 8）+ STORE（method 0）即可，无需第三方库。
 * 只解 `extension/` 下的内容并剥掉该前缀，使目标目录根部即为扩展的 package.json —— 与
 * extension.service.installFromFolder 的预期一致。不支持 zip64 / 加密（VSIX 不会用）。
 */

const EOCD_SIG = 0x06054b50
const CENTRAL_SIG = 0x02014b50
const LOCAL_SIG = 0x04034b50
const EXTENSION_PREFIX = 'extension/'

interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  localHeaderOffset: number
}

function findEocdOffset(buffer: Buffer): number {
  // EOCD 至少 22 字节，注释最长 65535；从末尾往前找签名
  const minPos = Math.max(0, buffer.length - (22 + 0xffff))
  for (let pos = buffer.length - 22; pos >= minPos; pos--) {
    if (buffer.readUInt32LE(pos) === EOCD_SIG) return pos
  }
  return -1
}

function readCentralDirectory(buffer: Buffer): ZipEntry[] {
  const eocd = findEocdOffset(buffer)
  if (eocd < 0) throw new Error('无效的 VSIX：未找到 ZIP 结尾记录')
  const total = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  const entries: ZipEntry[] = []
  for (let i = 0; i < total; i++) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIG) break
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLen = buffer.readUInt16LE(offset + 28)
    const extraLen = buffer.readUInt16LE(offset + 30)
    const commentLen = buffer.readUInt16LE(offset + 32)
    const localHeaderOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLen)
    entries.push({ name, method, compressedSize, localHeaderOffset })
    offset += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function extractEntryData(buffer: Buffer, entry: ZipEntry): Buffer {
  const base = entry.localHeaderOffset
  if (buffer.readUInt32LE(base) !== LOCAL_SIG) throw new Error(`ZIP 本地头损坏: ${entry.name}`)
  // 本地头的 nameLen/extraLen 可能与中央目录不同，须以本地头为准定位数据起点
  const nameLen = buffer.readUInt16LE(base + 26)
  const extraLen = buffer.readUInt16LE(base + 28)
  const dataStart = base + 30 + nameLen + extraLen
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize)
  if (entry.method === 0) return Buffer.from(compressed) // STORE
  if (entry.method === 8) return inflateRawSync(compressed) // DEFLATE
  throw new Error(`不支持的 ZIP 压缩方式 ${entry.method}: ${entry.name}`)
}

/** 防目录穿越：确保解出的路径落在 destDir 内。 */
function safeJoin(destDir: string, relative: string): string {
  const target = normalize(join(destDir, relative))
  const root = normalize(destDir.endsWith(sep) ? destDir : destDir + sep)
  if (target !== normalize(destDir) && !target.startsWith(root)) {
    throw new Error(`VSIX 条目越界: ${relative}`)
  }
  return target
}

/**
 * 解包 VSIX buffer 到目标目录（只解 `extension/` 下内容并剥前缀）。
 * @returns 解出的文件数
 */
export async function extractVsix(vsix: Buffer, destDir: string): Promise<number> {
  const entries = readCentralDirectory(vsix)
  let written = 0
  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue // 目录项
    if (!entry.name.startsWith(EXTENSION_PREFIX)) continue
    const relative = entry.name.slice(EXTENSION_PREFIX.length)
    if (!relative) continue
    const target = safeJoin(destDir, relative)
    const data = extractEntryData(vsix, entry)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, data)
    written++
  }
  if (written === 0) throw new Error('VSIX 中没有 extension/ 内容')
  return written
}
