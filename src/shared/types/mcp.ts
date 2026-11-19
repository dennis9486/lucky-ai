import type { AgentMcpServerConfig } from './ipc.js'

export type McpConnectionType = 'stdio' | 'http'

export interface McpKeyValue {
  key: string
  value: string
}

export interface McpServerFormState {
  name: string
  type: McpConnectionType
  command: string
  args: string[]
  env: McpKeyValue[]
  envForward: string[]
  cwd: string
  url: string
  bearerTokenEnv: string
  headers: McpKeyValue[]
  headerEnv: McpKeyValue[]
}

export interface McpPluginEntry {
  id: string
  name: string
}

export const MCP_PLUGIN_SERVERS: McpPluginEntry[] = [
  { id: 'codex_apps', name: 'codex_apps' },
  { id: 'computer-use', name: 'computer-use' }
]

export const DEFAULT_MCP_FORM: McpServerFormState = {
  name: '',
  type: 'stdio',
  command: '',
  args: [''],
  env: [],
  envForward: [],
  cwd: '',
  url: '',
  bearerTokenEnv: '',
  headers: [],
  headerEnv: []
}

export function slugifyMcpId(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return base || `mcp_${Date.now()}`
}

export function uniqueMcpId(name: string, existingIds: string[]): string {
  const id = slugifyMcpId(name)
  if (!existingIds.includes(id)) return id
  let index = 2
  while (existingIds.includes(`${id}_${index}`)) index += 1
  return `${id}_${index}`
}

export function configToForm(config: AgentMcpServerConfig): McpServerFormState {
  return {
    name: config.name,
    type: config.type,
    command: config.command ?? '',
    args: config.args?.length ? [...config.args] : [''],
    env: recordToPairs(config.env),
    envForward: config.envForward?.length ? [...config.envForward] : [],
    cwd: config.cwd ?? '',
    url: config.url ?? '',
    bearerTokenEnv: config.bearerTokenEnv ?? '',
    headers: recordToPairs(config.headers),
    headerEnv: recordToPairs(config.headerEnv)
  }
}

export function formToConfig(
  form: McpServerFormState,
  existingId?: string,
  existing?: Partial<AgentMcpServerConfig>
): AgentMcpServerConfig {
  const name = form.name.trim()
  const id = existingId ?? slugifyMcpId(name)

  const base: AgentMcpServerConfig = {
    id,
    name,
    enabled: existing?.enabled ?? true,
    type: form.type,
    requireUserConfirm: existing?.requireUserConfirm ?? true,
    source: 'user'
  }

  if (form.type === 'stdio') {
    return {
      ...base,
      command: form.command.trim(),
      args: form.args.map((arg) => arg.trim()).filter(Boolean),
      cwd: form.cwd.trim() || undefined,
      env: pairsToRecord(form.env),
      envForward: form.envForward.map((item) => item.trim()).filter(Boolean)
    }
  }

  return {
    ...base,
    url: form.url.trim(),
    transportType: 'streamable-http',
    stateful: true,
    bearerTokenEnv: form.bearerTokenEnv.trim() || undefined,
    headers: pairsToRecord(form.headers),
    headerEnv: pairsToRecord(form.headerEnv)
  }
}

export function validateMcpForm(form: McpServerFormState): string | null {
  if (!form.name.trim()) return '请填写名称'
  if (form.type === 'stdio') {
    if (!form.command.trim()) return '请填写启动命令'
    return null
  }
  if (!form.url.trim()) return '请填写 URL'
  try {
    new URL(form.url.trim())
  } catch {
    return 'URL 格式无效'
  }
  return null
}

function recordToPairs(record?: Record<string, string>): McpKeyValue[] {
  if (!record) return []
  return Object.entries(record).map(([key, value]) => ({ key, value }))
}

function pairsToRecord(pairs: McpKeyValue[]): Record<string, string> | undefined {
  const record: Record<string, string> = {}
  for (const pair of pairs) {
    const key = pair.key.trim()
    const value = pair.value.trim()
    if (key && value) record[key] = value
  }
  return Object.keys(record).length ? record : undefined
}

export function userMcpServers(servers: AgentMcpServerConfig[]): AgentMcpServerConfig[] {
  return servers.filter((server) => server.source !== 'plugin')
}
