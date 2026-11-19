import { describe, expect, it } from 'vitest'
import { sanitizeJsonSchema, sanitizeToolSchemas } from './json-schema.js'

describe('sanitizeJsonSchema', () => {
  it('rewrites OpenAPI boolean exclusiveMinimum to the numeric bound', () => {
    const node = { type: 'integer', minimum: 10, exclusiveMinimum: true }
    sanitizeJsonSchema(node)
    expect(node).toEqual({ type: 'integer', exclusiveMinimum: 10 })
  })

  it('drops boolean exclusive bounds set to false', () => {
    const node = { type: 'number', maximum: 5, exclusiveMaximum: false }
    sanitizeJsonSchema(node)
    expect(node).toEqual({ type: 'number', maximum: 5 })
  })

  it('deletes any numeric keyword mistyped as boolean, recursively', () => {
    const node = {
      type: 'object',
      properties: { n: { type: 'integer', minLength: true as unknown as number } }
    }
    sanitizeJsonSchema(node)
    expect(node.properties.n).toEqual({ type: 'integer' })
  })
})

describe('sanitizeToolSchemas', () => {
  function tool() {
    return {
      type: 'function',
      function: { name: 'x', parameters: { type: 'object', minProperties: true } }
    }
  }

  it('sanitizes each tool parameters node', () => {
    const tools = [tool()]
    sanitizeToolSchemas(tools)
    expect(tools[0]!.function.parameters).toEqual({ type: 'object' })
  })

  it('is idempotent on the same schema object (WeakSet-guarded)', () => {
    const tools = [tool()]
    sanitizeToolSchemas(tools)
    const first = tools[0]!.function.parameters
    sanitizeToolSchemas(tools) // second pass must not corrupt or throw
    expect(tools[0]!.function.parameters).toBe(first)
    expect(tools[0]!.function.parameters).toEqual({ type: 'object' })
  })

  it('still sanitizes a freshly-built schema object', () => {
    const fresh = [tool()]
    sanitizeToolSchemas(fresh)
    expect(fresh[0]!.function.parameters).toEqual({ type: 'object' })
  })
})
