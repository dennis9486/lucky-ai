# Agent 事件流

对话/Agent 主循环由 AgentScope SDK 承载。一次用户消息从发出到渲染完成，跨主进程与渲染进程共五层，事件全程以 `sessionId` + `toolCallId` 关联。

```
渲染进程                                 主进程
────────────────────────────────────    ─────────────────────────────────────
chat.store / code-agent.store
  └─ agentscope-client.ts
       ① 预生成 requestId
       ② 先订阅 AGENT_EVENT:<id>
       ③ invoke AGENT_SEND ──────────►  agent.ipc.ts
                                          └─ agent-manager.ts（ReActAgent 编排）
                                               ├─ toolkit-factory.ts（工具装配）
                                               ├─ model-factory.ts（模型 + schema 清洗
                                               │    + reasoning 回传 + prompt cache）
                                               └─ agent-storage.ts（上下文落库）
       ⑤ 累积 delta、拼装 parts  ◄──────  ④ event-bridge.ts 把 AgentScope 原生
          （text/thinking/tool）             AgentEvent 映射为扁平 AgentScopeEvent，
                                             经 webContents.send 推回
  └─ MessageParts.vue / ToolCallCard.vue / ThinkingCard.vue 渲染
```

## 各层职责

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 编排 | [agent-manager.ts](../src/main/agentscope/agent-manager.ts) | 按会话缓存/重建 Agent；系统提示词、项目上下文、记忆注入、上下文压缩（token 超 70% 自动压缩，保留最近 6 轮） |
| 工具 | [toolkit-factory.ts](../src/main/agentscope/toolkit-factory.ts) | 装配 `tools/` 下各工具群（文件/Bash/Web/浏览器/Git/实用/子代理），按审批策略决定 HITL 确认；MCP 客户端见 [mcp-client.ts](../src/main/agentscope/mcp-client.ts) |
| 事件映射 | [event-bridge.ts](../src/main/agentscope/event-bridge.ts) | AgentScope `AgentEvent` → IPC 友好的 `AgentScopeEvent`；保留 `tool_call_id` 贯穿工具生命周期（start → delta → end → result_*） |
| 渲染客户端 | [agentscope-client.ts](../src/renderer/services/agentscope-client.ts) | 订阅事件、累积流式 delta、把工具入参 JSON 增量拼装成结构化 `MessagePart` |
| 持久化 | [agent-storage.ts](../src/main/agentscope/agent-storage.ts) | 轮次结束 `saveState()` 把完整上下文（含压缩摘要）写入 `agent_contexts` 表，重启不失忆 |

## 已踩过的坑（改动前必读）

- **事件竞态**：渲染进程必须「先订阅、后 invoke」。requestId 由渲染侧预生成并作为事件通道键，否则主进程同步抛错（无工作区/无 Provider）会在订阅前丢失，UI 永远等不到 settle。
- **IPC 序列化**：任何来自 Pinia store 的对象过 IPC 前必须经 `utils/ipc-serialize.ts` 的 `toIpcPlain`，否则 Vue 响应式 Proxy 会让 structuredClone 抛 "An object could not be cloned"。
- **工具 schema 兼容**：DeepSeek 按 draft-07 校验函数 schema，zod 产出的布尔型 `exclusiveMinimum` 会 400。统一收口在 `json-schema.ts` 的 `sanitizeJsonSchema`，由 model-factory 包装 `model.call` 时清洗。
- **DeepSeek reasoning 回传**：带 tool_calls 的后续请求必须原样回传 `reasoning_content`，在 `reasoning-roundtrip.ts` 的 HTTP 层解决，勿在 formatter 层尝试。
