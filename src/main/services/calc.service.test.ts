import { describe, expect, it } from 'vitest'
import { evaluateExpression, CalcError } from './calc.service.js'

describe('evaluateExpression', () => {
  it('respects operator precedence and parentheses', () => {
    expect(evaluateExpression('1 + 2 * 3')).toBe(7)
    expect(evaluateExpression('(1 + 2) * 3')).toBe(9)
    expect(evaluateExpression('10 - 2 - 3')).toBe(5) // left-assoc
    expect(evaluateExpression('7 % 3')).toBe(1)
  })

  it('handles right-associative power and unary minus', () => {
    expect(evaluateExpression('2 ^ 3 ^ 2')).toBe(512) // 2^(3^2)
    expect(evaluateExpression('-3 ^ 2')).toBe(-9) // -(3^2)
    expect(evaluateExpression('2 ^ -1')).toBe(0.5)
    expect(evaluateExpression('--5')).toBe(5)
  })

  it('supports constants and functions (radians)', () => {
    expect(evaluateExpression('pi')).toBeCloseTo(Math.PI)
    expect(evaluateExpression('sqrt(2) ^ 2')).toBeCloseTo(2)
    expect(evaluateExpression('sin(pi / 6)')).toBeCloseTo(0.5)
    expect(evaluateExpression('log(100)')).toBeCloseTo(2) // single-arg log = base 10
    expect(evaluateExpression('log(2, 8)')).toBeCloseTo(3) // log base 2 of 8
    expect(evaluateExpression('hypot(3, 4)')).toBe(5)
    expect(evaluateExpression('max(1, 9, 4)')).toBe(9)
    expect(evaluateExpression('deg(pi)')).toBeCloseTo(180)
  })

  it('supports factorial postfix', () => {
    expect(evaluateExpression('5!')).toBe(120)
    expect(evaluateExpression('3! ^ 2')).toBe(36)
    expect(evaluateExpression('fact(4)')).toBe(24)
  })

  it('rejects invalid input safely (no eval)', () => {
    expect(() => evaluateExpression('')).toThrow(CalcError)
    expect(() => evaluateExpression('1 +')).toThrow(CalcError)
    expect(() => evaluateExpression('foo(1)')).toThrow(CalcError)
    expect(() => evaluateExpression('2 3')).toThrow(CalcError)
    expect(() => evaluateExpression('(1 + 2')).toThrow(CalcError)
    expect(() => evaluateExpression('1; process.exit()')).toThrow(CalcError)
    expect(() => evaluateExpression('sin(1, 2)')).toThrow(/参数个数/)
  })
})
