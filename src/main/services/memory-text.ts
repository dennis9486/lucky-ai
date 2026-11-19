/**
 * 记忆链路的文本基础层：规整 / 分词 / 相似度。
 * 纯函数、零依赖，是 memory-facts / memory-retrieval / memory.service 的公共底座。
 * 检索、去重、写入决策必须共用同一套分词（searchTokens），保证口径一致。
 */

export function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function truncate(value: string, max: number): string {
  const normalized = normalize(value)
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max - 1)}…`
}

export function normalizeMemoryText(value: string): string {
  return normalize(value)
    .replace(/\*\*/g, '')
    .replace(/^[\s"'“”‘’`]+|[\s"'“”‘’`]+$/g, '')
    .replace(/\s+([，。！？；：,.!?;:])/g, '$1')
    .replace(/([\p{Script=Han}])\s+([\p{Script=Han}])/gu, '$1$2')
    .replace(/[。.!！]+$/u, '')
}

export function normalizeForSearch(value: string): string {
  return normalize(value)
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'what', 'when', 'where', 'who', 'why', 'how',
  'are', 'was', 'were', 'you', 'your', 'me', 'my', 'mine', 'about', 'please',
  '什么', '怎么', '如何', '一下', '这个', '那个', '我们', '你们', '我的', '你的', '请问'
])

export const MEMORY_KEY_STOP_WORDS = new Set([
  ...STOP_WORDS,
  'current', 'new', 'old', 'before', 'after', 'changed', 'change', 'prefer', 'preference',
  'workflow', 'process', 'rule', 'policy', 'always', 'never', 'must', 'should', 'please',
  '现在', '当前', '新的', '旧的', '以前', '之后', '后来', '曾经', '流程', '规则', '规范', '约定',
  '需要', '必须', '不要', '可以', '不能', '默认', '优先', '改成', '变成', '变了'
])

export function searchTokens(query: string): string[] {
  const normalized = normalizeForSearch(query)
  const words = normalized
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
  const compact = normalized.replace(/\s+/gu, '')
  const scriptRuns = Array.from(compact.matchAll(/[\p{L}\p{N}]{2,}/gu)).flatMap((match) => charNgrams(match[0]))
  return [...new Set([...words, ...scriptRuns])].slice(0, 80)
}

function charNgrams(value: string): string[] {
  const chars = [...value]
  const grams: string[] = []
  for (let size = 2; size <= Math.min(5, chars.length); size++) {
    for (let i = 0; i + size <= chars.length; i++) {
      grams.push(chars.slice(i, i + size).join(''))
    }
  }
  return grams
}

export function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const left = new Set(a)
  const right = new Set(b)
  let intersection = 0
  for (const token of left) {
    if (right.has(token)) intersection++
  }
  return intersection / Math.max(left.size + right.size - intersection, 1)
}

/**
 * 本地、跨语言的语义相似度（mem0 思路，但无需嵌入模型/网络）。
 * 以 searchTokens 产出的「词 + 字符 n-gram」集合为特征，取集合余弦（Ochiai 系数）：
 *   sim = |A∩B| / sqrt(|A|·|B|) ∈ [0,1]
 * 相比 jaccard，对长度差异更稳健、对改写/语序更宽容；完全离线、零依赖，故“通用性强”。
 * 复用统一的 searchTokens 分词，保证与检索/排序口径一致。
 */
export function similarityFromTokens(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0
  const [small, large] = left.size <= right.size ? [left, right] : [right, left]
  let intersection = 0
  for (const token of small) {
    if (large.has(token)) intersection += 1
  }
  if (!intersection) return 0
  return intersection / Math.sqrt(left.size * right.size)
}

export function memorySimilarity(a: string, b: string): number {
  return similarityFromTokens(new Set(searchTokens(a)), new Set(searchTokens(b)))
}

export function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value as number), min), max)
}

export function clampNumber(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(value as number, min), max)
}
