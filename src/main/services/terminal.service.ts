import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import * as pty from 'node-pty'
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels.js'
import type { RunCommandResult } from '../../shared/types/ipc.js'
import { commandSandboxService, formatSandboxResult } from './command-sandbox.service.js'
import { securityService } from './security.service.js'

interface TerminalSession {
  id: string
  pty: pty.IPty
  output: string
  cwd: string
}

export class TerminalService {
  private sessions = new Map<string, TerminalSession>()
  private globalOutput = ''

  /** 创建交互式 PTY 终端会话 */
  createSession(cwd: string | undefined, sender: WebContents): { id: string; shellName: string; cwd: string } {
    const root = securityService.getWorkspaceRoot()
    if (!root) throw new Error('未打开工作区')

    const workDir = cwd ? securityService.resolveSafePath(cwd) : root
    const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL ?? '/bin/zsh'
    const shellArgs = process.platform === 'win32' ? [] : ['-l']

    const proc = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: workDir,
      env: buildTerminalEnv()
    })

    const id = randomUUID()
    const session: TerminalSession = { id, pty: proc, output: '', cwd: workDir }
    this.sessions.set(id, session)

    proc.onData((data) => {
      session.output += data
      this.globalOutput += data
      if (session.output.length > 100_000) {
        session.output = session.output.slice(-50_000)
      }
      if (!sender.isDestroyed()) {
        sender.send(IPC_CHANNELS.TERMINAL_DATA, { id, data })
      }
    })

    proc.onExit(() => {
      this.sessions.delete(id)
    })

    return { id, shellName: resolveShellName(shell), cwd: workDir }
  }

  write(id: string, data: string): void {
    const session = this.sessions.get(id)
    if (!session) throw new Error('终端会话不存在')
    session.pty.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id)
    if (!session) return
    session.pty.resize(Math.max(cols, 1), Math.max(rows, 1))
  }

  kill(id: string): void {
    const session = this.sessions.get(id)
    if (session) {
      session.pty.kill()
      this.sessions.delete(id)
    }
  }

  getOutput(id?: string): string {
    if (id) {
      return this.sessions.get(id)?.output ?? ''
    }
    return this.globalOutput
  }

  /** 执行单次命令并等待结果 */
  async runCommand(command: string, cwd = '.', confirmed = false): Promise<RunCommandResult> {
    const root = securityService.getWorkspaceRoot()
    if (!root) throw new Error('未打开工作区')

    const cmdCheck = securityService.checkCommand(command)
    if (cmdCheck.dangerLevel === 'confirm' && !confirmed) {
      return {
        exitCode: null,
        stdout: '',
        stderr: '',
        needsConfirm: true,
        blocked: false
      }
    }

    const workDir = securityService.resolveSafePath(cwd)
    const result = await commandSandboxService.execute({
      command,
      cwd: workDir,
      timeoutMs: 120_000
    })

    if (result.timedOut) {
      return {
        exitCode: null,
        stdout: result.stdout,
        stderr: `${result.stderr}\nCommand timed out`.trim(),
        needsConfirm: false,
        blocked: false
      }
    }

    this.globalOutput += `${result.stdout}${result.stderr}`

    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr || (result.exitCode === 0 ? '' : formatSandboxResult(result, command)),
      needsConfirm: false,
      blocked: false
    }
  }
}

export const terminalService = new TerminalService()

function resolveShellName(shellPath: string): string {
  if (process.platform === 'win32') return 'powershell'
  return shellPath.split('/').pop() || 'zsh'
}

function buildTerminalEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  delete env.NO_COLOR
  delete env.FORCE_NO_COLOR
  return {
    ...env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    FORCE_COLOR: '1',
    CLICOLOR: '1',
    CLICOLOR_FORCE: '1'
  }
}
