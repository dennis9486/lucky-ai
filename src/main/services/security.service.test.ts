import { describe, expect, it, afterEach, beforeEach } from 'vitest'
import { securityService } from './security.service.js'

describe('security service permission policy', () => {
  beforeEach(() => {
    securityService.setWorkspaceRoot('/tmp/lucky-workspace')
    securityService.setPermissionPolicy({ rules: [] })
  })

  afterEach(() => {
    securityService.setPermissionPolicy({ rules: [] })
  })

  it('allows matching command policies without skipping explicit blocks', () => {
    securityService.setPermissionPolicy({
      rules: [
        {
          id: 'allow-test',
          enabled: true,
          target: 'command',
          pattern: 'pnpm test*',
          action: 'allow'
        },
        {
          id: 'block-rm',
          enabled: true,
          target: 'command',
          pattern: 'rm -rf*',
          action: 'block',
          note: 'No destructive deletes'
        }
      ]
    })

    expect(securityService.checkToolPermission('run_command', { command: 'pnpm test' }, false).allowed).toBe(true)
    expect(securityService.checkToolPermission('run_command', { command: 'rm -rf dist' }, false)).toMatchObject({
      allowed: false,
      dangerLevel: 'blocked',
      reason: 'No destructive deletes'
    })
  })

  it('exposes AgentScope tool confirmation and block decisions', () => {
    securityService.setPermissionPolicy({
      rules: [
        {
          id: 'allow-read',
          enabled: true,
          target: 'tool',
          pattern: 'Read',
          action: 'allow'
        },
        {
          id: 'block-bash',
          enabled: true,
          target: 'tool',
          pattern: 'Bash',
          action: 'block'
        }
      ]
    })

    expect(securityService.shouldConfirmAgentTool('Read', true)).toBe(false)
    expect(() => securityService.assertAgentToolAllowed('Bash', { command: 'pwd' })).toThrow('工具策略阻止')
  })

  it('never lets path policies bypass workspace escapes', () => {
    securityService.setPermissionPolicy({
      rules: [
        {
          id: 'allow-all-paths',
          enabled: true,
          target: 'path',
          pattern: '*',
          action: 'allow'
        }
      ]
    })

    expect(securityService.checkToolPermission('read_file', { path: '../secret.txt' }, true)).toMatchObject({
      allowed: false,
      dangerLevel: 'blocked'
    })
  })

  it('flags destructive git commands for confirmation', () => {
    expect(securityService.checkCommand('git reset --hard HEAD')).toMatchObject({
      dangerLevel: 'confirm',
      reason: expect.stringContaining('git reset')
    })
    expect(securityService.checkCommand('git clean -fd')).toMatchObject({
      dangerLevel: 'confirm',
      reason: expect.stringContaining('git clean')
    })
    expect(securityService.checkCommand('git push origin main --force')).toMatchObject({
      dangerLevel: 'confirm'
    })
    expect(securityService.checkCommand('git status')).toMatchObject({ dangerLevel: 'none' })
  })
})
