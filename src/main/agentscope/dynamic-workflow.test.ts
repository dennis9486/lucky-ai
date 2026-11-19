import { describe, expect, it } from 'vitest'
import { isContinuationMessage, renderDynamicWorkflowPrompt, selectDynamicWorkflow } from './dynamic-workflow.js'

describe('dynamic workflow selection', () => {
  it('routes bug reports to debug workflow', () => {
    const workflow = selectDynamicWorkflow({
      message: '修复这个 no such column 报错',
      agentMode: 'code',
      approvalMode: 'ask'
    })

    expect(workflow?.intent).toBe('debug')
    expect(workflow?.phases.join(' ')).toContain('Trace likely root cause')
  })

  it('marks migrations as high risk', () => {
    const workflow = selectDynamicWorkflow({
      message: '新增数据库 migration 并删除旧字段',
      agentMode: 'code',
      approvalMode: 'auto'
    })

    expect(workflow?.risk).toBe('high')
    expect(workflow?.guardrails.join(' ')).toContain('pause for confirmation')
  })

  it('renders a compact prompt block with a precedence declaration', () => {
    const workflow = selectDynamicWorkflow({
      message: '帮我查最新文档',
      agentMode: 'chat',
      approvalMode: 'ask'
    })

    expect(workflow?.intent).toBe('research')
    const rendered = renderDynamicWorkflowPrompt(workflow!)
    expect(rendered).toContain('Dynamic workflow directive')
    // 对话历史优先声明：指令块猜错时模型应忽略它
    expect(rendered).toContain('take precedence')
  })

  it('ignores trigger words inside auto-collected context', () => {
    // 转录事故：项目上下文里出现 git/分支 等词，把「收集资料」劫持成 Git Workflow
    const workflow = selectDynamicWorkflow({
      message: '新建一个 支付资料 的目录 并收集一下中国企业对接支付的资料 注明来源',
      context: '项目结构：.git/ HEAD 当前分支 master，最近 commit 记录……',
      agentMode: 'chat',
      approvalMode: 'ask'
    })

    expect(workflow?.intent).not.toBe('git')
    expect(workflow?.intent).toBe('research')
  })

  it('requires git context for Chinese trigger words', () => {
    expect(selectDynamicWorkflow({ message: '帮我提交这个表单', agentMode: 'chat', approvalMode: 'ask' })?.intent).not.toBe('git')
    expect(selectDynamicWorkflow({ message: '把这两个文件合并成一个', agentMode: 'chat', approvalMode: 'ask' })?.intent).not.toBe('git')
    expect(selectDynamicWorkflow({ message: '提交代码并推送', agentMode: 'code', approvalMode: 'ask' })?.intent).toBe('git')
    expect(selectDynamicWorkflow({ message: '新建分支 feature/pay', agentMode: 'code', approvalMode: 'ask' })?.intent).toBe('git')
  })

  it('returns null for continuation messages so no directive is injected', () => {
    // 转录事故：「请继续完成上面的任务」「a」被注入 Git Workflow，
    // 模型照指令查 Git 状态，丢掉了自己刚问的 A/B/C 选项。
    for (const message of ['请继续完成上面的任务', '继续', 'a', 'B.', '1', '好的', '嗯嗯', 'ok', 'continue', '没问题']) {
      expect(selectDynamicWorkflow({ message, agentMode: 'chat', approvalMode: 'ask' })).toBeNull()
    }
  })

  it('keeps real short questions out of the continuation bucket', () => {
    expect(isContinuationMessage('为何?')).toBe(false)
    expect(isContinuationMessage('搜索最新的支付牌照政策')).toBe(false)
    expect(isContinuationMessage('a')).toBe(true)
    expect(isContinuationMessage('  ')).toBe(true)
  })
})
