/**
 * secret-redactor.ts — 敏感凭证遮罩
 *
 * 场景：Agent 会自主读取工作区文件（Read/Grep/Bash cat），.env、密钥文件的
 * 内容会随工具输出进入模型上下文并发送给 Provider。本模块在工具输出与
 * 用户上下文注入模型之前做一层确定性遮罩。
 *
 * 设计原则：
 * - 只遮罩值，保留键名与结构（模型仍能理解"这里有一个 API key 配置"）。
 * - 宁可漏报不可误伤代码：通用 key=value 规则要求键名含敏感词且值为高熵
 *   长 token；不匹配普通变量赋值。
 * - 纯函数、无 IO，可在 main/renderer 复用。
 */

/** 遮罩后的占位格式 */
function mask(kind: string): string {
  return `[REDACTED:${kind}]`
}

interface SecretRule {
  kind: string
  pattern: RegExp
  /** 替换实现（默认整体替换为占位符） */
  replace?: (match: RegExpExecArray) => string
}

/**
 * 凭证特征规则（顺序即应用顺序）。
 * 注意所有 RegExp 必须带 g 标志（statefully exec 全文）。
 */
const SECRET_RULES: SecretRule[] = [
  {
    // PEM 私钥块（RSA/EC/OPENSSH/PGP 等）
    kind: 'private-key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY( BLOCK)?-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY( BLOCK)?-----/g
  },
  {
    // AWS Access Key ID（AKIA/ASIA 前缀 + 16 位大写字母数字）
    kind: 'aws-access-key',
    pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g
  },
  {
    // GitHub token（ghp_ / gho_ / ghu_ / ghs_ / ghr_ / github_pat_）
    kind: 'github-token',
    pattern: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/g
  },
  {
    // Anthropic API key
    kind: 'anthropic-key',
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g
  },
  {
    // OpenAI 风格 key（sk- 前缀高熵 token；置于 anthropic 之后避免抢先匹配）
    kind: 'openai-key',
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g
  },
  {
    // Slack token
    kind: 'slack-token',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g
  },
  {
    // Google API key
    kind: 'google-api-key',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g
  },
  {
    // JWT（三段 base64url，header 以 eyJ 开头）
    kind: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g
  },
  {
    // 通用赋值：键名含敏感词 + 值为 ≥16 位无空格 token（.env / yaml / json / shell 形态）
    // 只遮罩值部分，保留键名。
    kind: 'generic-credential',
    pattern: /\b([A-Za-z0-9_.-]*(?:secret|password|passwd|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret)[A-Za-z0-9_.-]*)(\s*[:=]\s*)(["']?)(?!\[REDACTED:)([^\s"'`]{16,})\3/gi,
    replace: (match) => `${match[1]}${match[2]}${match[3]}${mask('credential')}${match[3]}`
  }
]

export interface RedactResult {
  text: string
  /** 遮罩命中次数（0 表示原文未动） */
  redactedCount: number
}

/**
 * 遮罩文本中的敏感凭证。
 * 幂等：占位符本身不会再次命中规则。
 */
export function redactSecrets(input: string): RedactResult {
  if (!input) return { text: input, redactedCount: 0 }

  let text = input
  let redactedCount = 0

  for (const rule of SECRET_RULES) {
    text = text.replace(rule.pattern, (...args) => {
      redactedCount += 1
      if (!rule.replace) return mask(rule.kind)
      // String.replace 回调参数还原为 exec 形态（含捕获组）
      const groups = args.slice(0, -2) as string[]
      return rule.replace(groups as unknown as RegExpExecArray)
    })
  }

  return { text, redactedCount }
}

/** 便捷判断：文本是否包含疑似凭证 */
export function containsSecrets(input: string): boolean {
  return SECRET_RULES.some((rule) => {
    rule.pattern.lastIndex = 0
    return rule.pattern.test(input)
  })
}
