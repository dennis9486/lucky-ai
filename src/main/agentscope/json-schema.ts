/**
 * json-schema.ts — JSON Schema 清洗模块
 *
 * 职责：将 AgentScope 以 OpenAPI 3.0 格式序列化的工具 schema 原地清洗为
 *       JSON Schema draft-07 兼容格式，确保 DeepSeek 等严格校验的模型能够
 *       正常接受函数调用声明。
 *
 * 背景：AgentScope 的 zod→JSON Schema 序列化使用 `target: "openapi-3.0"`，
 *       这会把 `.positive()/.int()/.min()` 等约束输出为 OpenAPI 3.0 的布尔
 *       型 `exclusiveMinimum`/`exclusiveMaximum`（如 `exclusiveMinimum: true`）。
 *       部分模型（如 DeepSeek）按 JSON Schema draft-07 校验，要求这些关键字
 *       必须是数字，否则报 400 "true is not of type number"。
 *
 * 数据流：tools → sanitizeToolSchemas() → sanitizeJsonSchema() (per tool)
 *         该清洗作为送往模型前的单一收口，覆盖工具调用 + 结构化输出两条路径。
 */

/**
 * 可能被错误赋成布尔值的数值型 JSON Schema 关键字。
 * 完整列表覆盖 OpenAPI 3.0 / JSON Schema 的数值与长度约束字段。
 */
const NUMERIC_SCHEMA_KEYWORDS = [
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties'
] as const

/**
 * 原地递归清洗单个 JSON Schema 节点。
 *
 * 转换规则：
 * 1. OpenAPI 3.0 的布尔型 `exclusiveMinimum`/`exclusiveMaximum` → 若为 true
 *    则用对应 `minimum`/`maximum` 的值替换并删除原字段；否则直接删除。
 * 2. 其余数值关键字若被错误类型化为布尔值，直接删除。
 * 3. 递归处理所有子节点（对象属性值、数组元素）。
 *
 * @param node - 待清洗的 Schema 节点（原地修改，无返回值）
 */
export function sanitizeJsonSchema(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) sanitizeJsonSchema(item)
    return
  }
  if (!node || typeof node !== 'object') return
  const obj = node as Record<string, unknown>

  // Step 1: 处理 OpenAPI 3.0 特有的布尔型 exclusiveMinimum / exclusiveMaximum
  // 例如 { minimum: 10, exclusiveMinimum: true } → { exclusiveMinimum: 10 }
  for (const [boolKey, numKey] of [
    ['exclusiveMinimum', 'minimum'],
    ['exclusiveMaximum', 'maximum']
  ] as const) {
    if (typeof obj[boolKey] === 'boolean') {
      if (obj[boolKey] === true && typeof obj[numKey] === 'number') {
        obj[boolKey] = obj[numKey]
        delete obj[numKey]
      } else {
        delete obj[boolKey]
      }
    }
  }

  // Step 2: 防御性清理——任何数值关键字若仍为布尔，直接删除
  for (const key of NUMERIC_SCHEMA_KEYWORDS) {
    if (typeof obj[key] === 'boolean') delete obj[key]
  }

  // Step 3: 递归处理子节点
  for (const value of Object.values(obj)) sanitizeJsonSchema(value)
}

/**
 * 清洗工具数组中的每个工具的入参 schema。
 *
 * 输入格式预期为 AgentScope Toolkit 生成的工具描述数组：
 * `[{ type: 'function', function: { name, description, parameters } }]`
 * 仅对 `parameters` 节点执行递归清洗，不影响工具名称和描述。
 *
 * @param tools - 工具描述数组（原地修改）
 */
/**
 * 已清洗过的 parameters 节点集合。
 * getJSONSchemas 常在同一轮多次模型调用间返回同一批（被缓存的）schema 对象，
 * withSchemaSanitizer 每次调用都会走一遍 sanitizeToolSchemas——用 WeakSet 标记后
 * 避免对同一 schema 对象重复递归清洗；对结构化输出等每次新建的 schema 仍会清洗。
 */
const sanitizedParameters = new WeakSet<object>()

export function sanitizeToolSchemas(tools: unknown): void {
  if (!Array.isArray(tools)) return
  for (const tool of tools) {
    const params = (tool as { function?: { parameters?: unknown } })?.function?.parameters
    if (params && typeof params === 'object' && !sanitizedParameters.has(params)) {
      sanitizeJsonSchema(params)
      sanitizedParameters.add(params)
    }
  }
}
