/** Agent 模型调用用量的聚合视图（用量面板数据源） */

/** 单日用量 */
export interface AgentUsageDay {
  /** 本地日期，YYYY-MM-DD */
  date: string
  inputTokens: number
  outputTokens: number
  calls: number
}

/** 按模型聚合 */
export interface AgentUsageByModel {
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  calls: number
}

export interface AgentUsageSummary {
  totalInputTokens: number
  totalOutputTokens: number
  totalCalls: number
  /** 最近 N 天逐日用量（含 0 值日），升序 */
  days: AgentUsageDay[]
  /** 按模型聚合（调用量降序，最多 10 条） */
  models: AgentUsageByModel[]
}
