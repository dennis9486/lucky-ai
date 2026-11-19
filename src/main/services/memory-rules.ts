export type MemoryIntent =
  | 'identity'
  | 'preference'
  | 'profile'
  | 'project'
  | 'workflow'
  | 'decision'
  | 'constraint'
  | 'tooling'
  | 'ui'
  | 'domain'

export function isMemoryHistoryQuery(query: string): boolean {
  return /(以前|之前|过去|曾经|原来|历史|变更|变化|改过|换过|旧的|上一版|先前|演进|沿革|为什么变|怎么变|previous|formerly|former|used to|before|history|historical|changed|old|past|prior|earlier|evolution|evolved)/i.test(query)
}

export function detectMemoryIntents(text: string): Set<MemoryIntent> {
  const intents = new Set<MemoryIntent>()
  if (/(叫什么|名字|姓名|称呼|我叫|叫我|name|called|call me|who am i|identity)/i.test(text)) intents.add('identity')
  if (/(偏好|喜欢|习惯|风格|语气|prefer|preference|like|habit|tone|style)/i.test(text)) intents.add('preference')
  if (/(年龄|几岁|多大|所在地|邮箱|角色|职业|profile|age|location|email|role|job|title)/i.test(text)) intents.add('profile')
  if (/(项目|仓库|模块|架构|workspace|repo|repository|project|module|architecture|codebase)/i.test(text)) intents.add('project')
  if (/(流程|步骤|规范|约定|workflow|process|convention|standard|rule|procedure|policy)/i.test(text)) intents.add('workflow')
  if (/(决定|方案|取舍|选择|decision|decide|chosen|tradeoff|option|approach)/i.test(text)) intents.add('decision')
  if (/(不要|必须|总是|禁止|约束|限制|never|always|must|constraint|forbid|avoid|required)/i.test(text)) intents.add('constraint')
  if (/(工具|mcp|agent|agentscope|git|terminal|crawler|爬虫|检索|tool|browser|web|search|crawl)/i.test(text)) intents.add('tooling')
  if (/(ui|界面|样式|布局|交互|按钮|弹窗|视觉|style|layout|modal|component|interaction|design)/i.test(text)) intents.add('ui')
  if (/(业务|领域|客户|产品|指标|domain|business|product|metric|customer|market)/i.test(text)) intents.add('domain')
  return intents
}

export function intentWeight(intent: MemoryIntent): number {
  switch (intent) {
    case 'identity': return 22
    case 'preference': return 18
    case 'profile': return 18
    case 'project': return 16
    case 'workflow': return 16
    case 'decision': return 17
    case 'constraint': return 18
    case 'tooling': return 14
    case 'ui': return 14
    case 'domain': return 12
  }
}

