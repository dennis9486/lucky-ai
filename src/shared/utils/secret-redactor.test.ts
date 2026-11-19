import { describe, expect, it } from 'vitest'
import { containsSecrets, redactSecrets } from './secret-redactor.js'

describe('redactSecrets', () => {
  it('redacts AWS access key ids', () => {
    const { text, redactedCount } = redactSecrets('key=AKIAIOSFODNN7EXAMPLE done')
    expect(text).toContain('[REDACTED:aws-access-key]')
    expect(text).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(redactedCount).toBe(1)
  })

  it('redacts PEM private key blocks including multiline body', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\nabc123\n-----END RSA PRIVATE KEY-----'
    const { text } = redactSecrets(`before\n${pem}\nafter`)
    expect(text).toContain('[REDACTED:private-key]')
    expect(text).not.toContain('MIIEowIBAAKCAQEA')
    expect(text).toContain('before')
    expect(text).toContain('after')
  })

  it('redacts vendor tokens (github / anthropic / openai / slack / google / jwt)', () => {
    const samples: Array<[string, string]> = [
      ['ghp_' + 'a1B2'.repeat(10), 'github-token'],
      ['github_pat_' + 'a1B2c3D4'.repeat(4), 'github-token'],
      ['sk-ant-api03-' + 'x'.repeat(24), 'anthropic-key'],
      ['sk-' + 'proj1234'.repeat(4), 'openai-key'],
      ['xoxb-1234567890-abcdefghij', 'slack-token'],
      ['AIza' + 'B'.repeat(35), 'google-api-key'],
      [`eyJ${'a'.repeat(12)}.eyJ${'b'.repeat(12)}.${'c'.repeat(16)}`, 'jwt']
    ]
    for (const [secret, kind] of samples) {
      const { text } = redactSecrets(`value: ${secret}`)
      expect(text, `${kind} should be redacted`).toContain(`[REDACTED:${kind}]`)
      expect(text).not.toContain(secret)
    }
  })

  it('redacts generic credential assignments but keeps the key name', () => {
    const env = 'DATABASE_PASSWORD=super-secret-value-123456\nAPI_KEY: "tok_abcdefghijklmnop"'
    const { text, redactedCount } = redactSecrets(env)
    expect(text).toContain('DATABASE_PASSWORD=')
    expect(text).toContain('API_KEY: ')
    expect(text).not.toContain('super-secret-value-123456')
    expect(text).not.toContain('tok_abcdefghijklmnop')
    expect(redactedCount).toBe(2)
  })

  it('does not touch ordinary code and short values', () => {
    const code = [
      'const apiKeyName = "primary"', // 值不足 16 位
      'let counter = 12345',
      'password = "short"',
      'const secretIndex = items.length' // 值非 token 形态（含空格/表达式）
    ].join('\n')
    const { text, redactedCount } = redactSecrets(code)
    expect(text).toBe(code)
    expect(redactedCount).toBe(0)
  })

  it('is idempotent — redacted output does not match again', () => {
    const once = redactSecrets('token=abcdefghijklmnopqrstuvwx')
    const twice = redactSecrets(once.text)
    expect(twice.text).toBe(once.text)
    expect(twice.redactedCount).toBe(0)
  })

  it('handles empty input', () => {
    expect(redactSecrets('')).toEqual({ text: '', redactedCount: 0 })
  })
})

describe('containsSecrets', () => {
  it('detects secrets and stays stateless across calls', () => {
    const sample = 'AKIAIOSFODNN7EXAMPLE'
    expect(containsSecrets(sample)).toBe(true)
    // g 标志正则的 lastIndex 已复位，连续调用结果一致
    expect(containsSecrets(sample)).toBe(true)
    expect(containsSecrets('plain text')).toBe(false)
  })
})
