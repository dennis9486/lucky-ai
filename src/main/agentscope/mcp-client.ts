import { isAbsolute, resolve } from 'node:path'
import { HTTPMCPClient, StdioMCPClient } from '@agentscope-ai/agentscope/mcp'
import { securityService } from '../services/security.service.js'
import type { AgentMcpServerConfig } from '../../shared/types/ipc.js'

/** MCP 客户端构造：sse=旧版 / streamable-http=新版，二者不可混用（混用报 "Failed to send message"） */
export function createMcpClient(server: AgentMcpServerConfig): HTTPMCPClient | StdioMCPClient {
  if (server.type === 'http') {
    if (!server.url) throw new Error('HTTP MCP 需要配置 url')
    validateMcpHttpUrl(server.url)
    const transportOpts = buildHttpTransportOpts(server)
    return new HTTPMCPClient({
      name: server.name,
      transportType: server.transportType ?? 'streamable-http',
      url: server.url,
      stateful: server.stateful ?? true,
      transportOpts
    })
  }

  if (!server.command) throw new Error('STDIO MCP 需要配置 command')
  return new StdioMCPClient({
    name: server.name,
    command: server.command,
    args: server.args ?? [],
    cwd: resolveMcpCwd(server.cwd),
    env: buildStdioEnv(server)
  })
}

function validateMcpHttpUrl(raw: string): void {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`MCP URL 无效: ${raw}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`MCP HTTP 仅支持 http/https: ${parsed.protocol}`)
  }
}

function resolveMcpCwd(cwd?: string): string {
  const root = securityService.getWorkspaceRoot() ?? process.cwd()
  if (!cwd) return root
  const resolved = isAbsolute(cwd) ? cwd : resolve(root, cwd)
  return securityService.resolveSafePath(resolved)
}

function buildHttpTransportOpts(
  server: AgentMcpServerConfig
): { requestInit?: { headers?: Record<string, string> } } | undefined {
  const headers: Record<string, string> = { ...(server.headers ?? {}) }

  if (server.bearerTokenEnv) {
    const token = process.env[server.bearerTokenEnv]
    if (token) headers.Authorization = `Bearer ${token}`
  }

  for (const [headerName, envVar] of Object.entries(server.headerEnv ?? {})) {
    const value = process.env[envVar]
    if (value) headers[headerName] = value
  }

  if (!Object.keys(headers).length) return undefined
  return { requestInit: { headers } }
}

function buildStdioEnv(server: AgentMcpServerConfig): Record<string, string> {
  const env = makeMcpEnv(server.env)
  for (const key of server.envForward ?? []) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  return env
}

function makeMcpEnv(overrides?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  return { ...env, ...(overrides ?? {}) }
}
