import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * IPC 契约测试（静态分析，无需 electron）。
 *
 * 渲染进程只能通过 preload 桥接与主进程通信；一旦某个 IPC 通道被改名/漏注册，
 * 类型系统抓不到（通道是字符串常量），运行时才会静默失败。此测试把「preload 调用的通道」
 * 与「main 注册的处理器」做集合对账，把这类回归拦在单测层。
 */

const here = dirname(fileURLToPath(import.meta.url))
const srcRoot = join(here, '..', '..')
const preloadPath = join(srcRoot, 'preload', 'index.ts')
const mainRoot = join(srcRoot, 'main')
const channelsPath = join(srcRoot, 'shared', 'constants', 'ipc-channels.ts')

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    // 排除测试文件自身，避免其中的正则字面量污染扫描结果
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full)
  }
  return out
}

function matchAll(text: string, re: RegExp): Set<string> {
  const found = new Set<string>()
  for (const m of text.matchAll(re)) found.add(m[1]!)
  return found
}

/** ipc-channels.ts 里声明的全部通道常量名。 */
function declaredChannels(): Set<string> {
  const body = read(channelsPath)
  // 形如 `FOO_BAR: 'foo:bar',`（值可为字符串），只取 key
  return matchAll(body, /^\s*([A-Z0-9_]+):\s*'/gm)
}

const mainSource = walk(mainRoot).map(read).join('\n')
const preloadSource = read(preloadPath)

const declared = declaredChannels()
// \s 会跨行匹配，故多行书写的 `ipcMain.handle(\n  IPC_CHANNELS.X` 也能被识别
const handled = matchAll(mainSource, /ipcMain\.(?:handle|on)\(\s*IPC_CHANNELS\.([A-Z0-9_]+)/g)
const emitted = matchAll(mainSource, /\.send\(\s*IPC_CHANNELS\.([A-Z0-9_]+)/g)
const invoked = matchAll(preloadSource, /invoke\(\s*IPC_CHANNELS\.([A-Z0-9_]+)/g)
const subscribed = matchAll(preloadSource, /ipcRenderer\.on\(\s*IPC_CHANNELS\.([A-Z0-9_]+)/g)

function missing(from: Set<string>, against: Set<string>): string[] {
  return [...from].filter((ch) => !against.has(ch)).sort()
}

describe('IPC contract: preload ↔ main', () => {
  it('sanity: extraction found a meaningful number of channels', () => {
    expect(declared.size).toBeGreaterThan(50)
    expect(handled.size).toBeGreaterThan(50)
    expect(invoked.size).toBeGreaterThan(50)
  })

  it('every channel the renderer invokes has a registered main handler', () => {
    expect(missing(invoked, handled)).toEqual([])
  })

  it('every channel the renderer subscribes to is emitted somewhere in main', () => {
    expect(missing(subscribed, emitted)).toEqual([])
  })

  it('every invoked / handled / subscribed / emitted channel is a declared constant', () => {
    const all = new Set([...invoked, ...handled, ...subscribed, ...emitted])
    expect(missing(all, declared)).toEqual([])
  })
})
