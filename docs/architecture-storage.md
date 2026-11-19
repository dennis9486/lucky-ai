# 存储 Schema

本地持久化基于 better-sqlite3，库文件在 `userData` 目录（E2E 通过 `LUCKY_USER_DATA_DIR` 隔离）。入口 [database.service.ts](../src/main/db/database.service.ts)，schema 演进全部走 [migrations.ts](../src/main/db/migrations.ts)：`MIGRATIONS` 是 `版本号 → SQL 列表` 的映射，`CURRENT_SCHEMA_VERSION` 当前为 18，启动时按 `schema_migrations` 表逐版本补齐。**改表只能追加新版本，绝不改历史版本的 SQL**（migrations.test.ts 会拿真实库跑全量迁移）。

## 表清单（按引入版本）

| 版本 | 表 | 用途 |
| --- | --- | --- |
| v1 | `projects` / `sessions` / `messages` / `app_preferences` | 首页对话：项目、会话、消息、KV 偏好 |
| v2 | `messages.parts_json` 列 | 结构化消息 parts（text/thinking/tool），工具卡片渲染的持久化基础 |
| v3 | `sessions.archived_at` 列 + `browser_bookmarks` / `browser_history` / `browser_downloads` | 会话归档 + 内嵌浏览器数据 |
| v4 | `agent_memories` / `agent_memory_events` / `agent_memory_fts`(FTS5 虚表) | Agent 记忆主表 + 只写审计表（上限 5000 行，超出裁最旧）+ 全文检索 |
| v5 | `messages.meta_json` 列 | 消息元数据 |
| v6 | `code_agent_state` / `code_agent_sessions` / `code_agent_turns` | Code Workbench 侧板的会话/轮次持久化 |
| v7 | `scheduled_tasks` | 已安排任务 |
| v8 | code_agent 多工作区列 | 会话按工作区隔离 |
| v9-v11 | `scheduled_task_runs` + run_mode/pending/remind 列 | 任务运行历史、notify/auto 双模式、待确认运行 |
| v12 | `agent_runtime_events` / `agent_runtime_traces` / `agent_context_audits` | Agent runtime（Brain）观测 |
| v13 | `agent_contexts` / `agent_file_checkpoints` + `code_agent_turns.agent_session_id` | **会话持久化重启不失忆**（SqliteAgentStorage）+ 轮次级文件前像回滚；conversationId 轮换不变量在此版本迁移 |
| v14 | `agent_usage` | token 用量统计 |
| v15-v16 | `browser_page_monitors` (+ ai_analyze 列) | 页面监控 |
| v17 | `agent_memories.use_count` 列 | 记忆被检索命中的次数，供频率加权与遗忘打分 |
| v18 | `agent_context_manifests` | 每一轮上下文来源、预算、选中/跳过原因，供 Brain 界面审计 |

## 关键约定

- **`agent_contexts`**：每会话一行，`context_json` 存完整 AgentScope 对话上下文（含工具调用与压缩摘要）。落库前 `trimContextForPersistence` 从最旧消息裁到体积预算内（AgentScope 压缩通常已先收敛，这是最后防线）。损坏的 JSON 按字段丢弃并 warn，不炸整个会话。
- **`agent_memories`**：记忆生命周期 `active/archived/deleted` 只做状态翻转不物理删；`content_hash` 唯一约束 + slot（canonicalKey）冲突交替 + 语义近重复 REINFORCE 三层去重。纯逻辑分层见 `services/memory-text.ts` → `memory-facts.ts` → `memory-retrieval.ts`，SQL 编排在 `memory.service.ts`。
- **`agent_memory_events`**：只写审计表，全仓无读取方，不要在关键路径上逐条写（历史教训：一次检索 200 条 × 2 写 = 400 次同步写）。
- **`agent_file_checkpoints`**：Write/Edit/GeneratePdf 落盘前经 `onBeforeFileMutation` 钩子捕获前像，支撑轮次级回滚；快照失败绝不阻断工具执行。
