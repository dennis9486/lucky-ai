/**
 * calc.service.ts — 安全的科学计算表达式求值（零依赖、纯函数、可单测）。
 *
 * 采用「词法分析 + 递归下降」而非 eval / Function，杜绝任意代码执行。
 * 支持：+ - * / %、^（右结合幂）、一元正负、括号、阶乘后缀 `!`、常量、以及一批科学函数。
 *
 * 精度说明：基于 IEEE-754 double，与 JS 原生数值一致；不做任意精度。
 */

type FnDef = { minArgs: number; maxArgs: number; apply: (args: number[]) => number }

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  tau: Math.PI * 2,
  e: Math.E,
  phi: (1 + Math.sqrt(5)) / 2,
  inf: Infinity,
  nan: NaN
}

function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) throw new CalcError(`阶乘要求非负整数，收到 ${n}`)
  if (n > 170) return Infinity // 171! 超过 double 上限
  let result = 1
  for (let i = 2; i <= n; i++) result *= i
  return result
}

const FUNCTIONS: Record<string, FnDef> = {
  sin: unary(Math.sin), cos: unary(Math.cos), tan: unary(Math.tan),
  asin: unary(Math.asin), acos: unary(Math.acos), atan: unary(Math.atan),
  sinh: unary(Math.sinh), cosh: unary(Math.cosh), tanh: unary(Math.tanh),
  sqrt: unary(Math.sqrt), cbrt: unary(Math.cbrt), exp: unary(Math.exp),
  ln: unary(Math.log), log2: unary(Math.log2), log10: unary(Math.log10), lg: unary(Math.log10),
  abs: unary(Math.abs), floor: unary(Math.floor), ceil: unary(Math.ceil),
  round: unary(Math.round), trunc: unary(Math.trunc), sign: unary(Math.sign),
  deg: unary((x) => (x * 180) / Math.PI), rad: unary((x) => (x * Math.PI) / 180),
  fact: unary(factorial),
  // 单参 log(x)=以10为底（计算器惯例）；双参 log(base, x)=以 base 为底
  log: { minArgs: 1, maxArgs: 2, apply: (a) => (a.length === 1 ? Math.log10(a[0]!) : Math.log(a[1]!) / Math.log(a[0]!)) },
  pow: { minArgs: 2, maxArgs: 2, apply: (a) => Math.pow(a[0]!, a[1]!) },
  atan2: { minArgs: 2, maxArgs: 2, apply: (a) => Math.atan2(a[0]!, a[1]!) },
  hypot: { minArgs: 1, maxArgs: Infinity, apply: (a) => Math.hypot(...a) },
  min: { minArgs: 1, maxArgs: Infinity, apply: (a) => Math.min(...a) },
  max: { minArgs: 1, maxArgs: Infinity, apply: (a) => Math.max(...a) }
}

function unary(fn: (x: number) => number): FnDef {
  return { minArgs: 1, maxArgs: 1, apply: (a) => fn(a[0]!) }
}

export class CalcError extends Error {}

type Token =
  | { type: 'num'; value: number }
  | { type: 'ident'; value: string }
  | { type: 'op'; value: string }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'comma' }

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const src = input.trim()
  while (i < src.length) {
    const ch = src[i]!
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue }
    if (ch === '(') { tokens.push({ type: 'lparen' }); i++; continue }
    if (ch === ')') { tokens.push({ type: 'rparen' }); i++; continue }
    if (ch === ',') { tokens.push({ type: 'comma' }); i++; continue }
    if ('+-*/%^!'.includes(ch)) { tokens.push({ type: 'op', value: ch }); i++; continue }
    if (/[0-9.]/.test(ch)) {
      const match = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i))
      if (!match) throw new CalcError(`无法解析数字，位置 ${i}`)
      tokens.push({ type: 'num', value: Number(match[0]) })
      i += match[0].length
      continue
    }
    if (/[a-zA-Z_]/.test(ch)) {
      const match = /^[a-zA-Z_]\w*/.exec(src.slice(i))!
      tokens.push({ type: 'ident', value: match[0].toLowerCase() })
      i += match[0].length
      continue
    }
    throw new CalcError(`非法字符 “${ch}”，位置 ${i}`)
  }
  return tokens
}

/** 递归下降解析器：expr → addSub → mulDiv → unary → power → postfix → primary。 */
class Parser {
  private pos = 0
  constructor(private readonly tokens: Token[]) {}

  parse(): number {
    if (!this.tokens.length) throw new CalcError('空表达式')
    const value = this.addSub()
    if (this.pos < this.tokens.length) throw new CalcError('表达式尾部有多余内容')
    return value
  }

  private peek(): Token | undefined { return this.tokens[this.pos] }
  private next(): Token { return this.tokens[this.pos++]! }

  private addSub(): number {
    let left = this.mulDiv()
    for (let t = this.peek(); t?.type === 'op' && (t.value === '+' || t.value === '-'); t = this.peek()) {
      this.next()
      const right = this.mulDiv()
      left = t.value === '+' ? left + right : left - right
    }
    return left
  }

  private mulDiv(): number {
    let left = this.unary()
    for (let t = this.peek(); t?.type === 'op' && '*/%'.includes(t.value); t = this.peek()) {
      this.next()
      const right = this.unary()
      left = t.value === '*' ? left * right : t.value === '/' ? left / right : left % right
    }
    return left
  }

  private unary(): number {
    const t = this.peek()
    if (t?.type === 'op' && (t.value === '+' || t.value === '-')) {
      this.next()
      const value = this.unary()
      return t.value === '-' ? -value : value
    }
    return this.power()
  }

  private power(): number {
    const base = this.postfix()
    const t = this.peek()
    if (t?.type === 'op' && t.value === '^') {
      this.next()
      return Math.pow(base, this.unary()) // 右结合：指数再走一遍 unary
    }
    return base
  }

  private postfix(): number {
    let value = this.primary()
    for (let t = this.peek(); t?.type === 'op' && t.value === '!'; t = this.peek()) {
      this.next()
      value = factorial(value)
    }
    return value
  }

  private primary(): number {
    const t = this.peek()
    if (!t) throw new CalcError('表达式意外结束')
    if (t.type === 'num') { this.next(); return t.value }
    if (t.type === 'lparen') {
      this.next()
      const value = this.addSub()
      if (this.peek()?.type !== 'rparen') throw new CalcError('缺少右括号')
      this.next()
      return value
    }
    if (t.type === 'ident') {
      this.next()
      // 函数调用
      if (this.peek()?.type === 'lparen') {
        const fn = FUNCTIONS[t.value]
        if (!fn) throw new CalcError(`未知函数 “${t.value}”`)
        const args = this.argList()
        if (args.length < fn.minArgs || args.length > fn.maxArgs) {
          throw new CalcError(`函数 “${t.value}” 参数个数不符（收到 ${args.length}）`)
        }
        return fn.apply(args)
      }
      // 常量
      if (t.value in CONSTANTS) return CONSTANTS[t.value]!
      throw new CalcError(`未知标识符 “${t.value}”`)
    }
    throw new CalcError('表达式语法错误')
  }

  private argList(): number[] {
    this.next() // consume '('
    const args: number[] = []
    if (this.peek()?.type === 'rparen') { this.next(); return args }
    args.push(this.addSub())
    while (this.peek()?.type === 'comma') {
      this.next()
      args.push(this.addSub())
    }
    if (this.peek()?.type !== 'rparen') throw new CalcError('函数参数缺少右括号')
    this.next()
    return args
  }
}

/** 安全求值一个科学计算表达式。非法输入抛 CalcError。 */
export function evaluateExpression(expression: string): number {
  if (typeof expression !== 'string' || !expression.trim()) throw new CalcError('表达式不能为空')
  if (expression.length > 2000) throw new CalcError('表达式过长')
  const result = new Parser(tokenize(expression)).parse()
  if (typeof result !== 'number') throw new CalcError('求值结果非数值')
  return result
}
