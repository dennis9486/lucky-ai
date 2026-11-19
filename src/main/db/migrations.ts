/** SQLite schema migrations — 版本递增，不可修改已发布 migration */
export const CURRENT_SCHEMA_VERSION = 18

export const MIGRATIONS: Record<number, string[]> = {
  1: [
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      applied_at  INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      root_path   TEXT NOT NULL UNIQUE,
      added_at    INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      id              TEXT PRIMARY KEY,
      title           TEXT NOT NULL,
      workspace_name  TEXT NOT NULL,
      workspace_path  TEXT,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_updated_at
      ON sessions(updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_workspace_path
      ON sessions(workspace_path)`,
    `CREATE TABLE IF NOT EXISTS messages (
      id              TEXT PRIMARY KEY,
      session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role            TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant', 'tool')),
      content         TEXT NOT NULL DEFAULT '',
      tool_call_id    TEXT,
      tool_calls_json TEXT,
      sort_order      INTEGER NOT NULL,
      timestamp       INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_messages_session_order
      ON messages(session_id, sort_order)`,
    `CREATE TABLE IF NOT EXISTS app_preferences (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`
  ],
  2: [
    // 结构化助手回合片段（文本 + 工具卡片）持久化
    `ALTER TABLE messages ADD COLUMN parts_json TEXT`
  ],
  3: [
    `ALTER TABLE sessions ADD COLUMN archived_at INTEGER`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_archived_at ON sessions(archived_at)`,
    `CREATE TABLE IF NOT EXISTS browser_bookmarks (
      id          TEXT PRIMARY KEY,
      url         TEXT NOT NULL,
      title       TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS browser_history (
      id          TEXT PRIMARY KEY,
      url         TEXT NOT NULL,
      title       TEXT NOT NULL,
      visited_at  INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_browser_history_visited ON browser_history(visited_at DESC)`,
    `CREATE TABLE IF NOT EXISTS browser_downloads (
      id              TEXT PRIMARY KEY,
      url             TEXT NOT NULL,
      filename        TEXT NOT NULL,
      save_path       TEXT NOT NULL DEFAULT '',
      total_bytes     INTEGER NOT NULL DEFAULT 0,
      received_bytes  INTEGER NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'progressing',
      started_at      INTEGER NOT NULL,
      completed_at    INTEGER
    )`
  ],
  4: [
    `CREATE TABLE IF NOT EXISTS agent_memories (
      id                 TEXT PRIMARY KEY,
      kind               TEXT NOT NULL CHECK(kind IN (
                           'preference',
                           'fact',
                           'project',
                           'workflow',
                           'decision',
                           'summary',
                           'instruction'
                         )),
      scope              TEXT NOT NULL CHECK(scope IN ('global', 'workspace', 'project', 'session')),
      title              TEXT NOT NULL DEFAULT '',
      content            TEXT NOT NULL,
      summary            TEXT NOT NULL DEFAULT '',
      tags_json          TEXT NOT NULL DEFAULT '[]',
      entities_json      TEXT NOT NULL DEFAULT '[]',
      workspace_path     TEXT,
      project_id         TEXT REFERENCES projects(id) ON DELETE SET NULL,
      session_id         TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      source_message_id  TEXT REFERENCES messages(id) ON DELETE SET NULL,
      source_type        TEXT NOT NULL CHECK(source_type IN (
                           'manual',
                           'chat',
                           'project_file',
                           'import',
                           'system'
                         )),
      source_url         TEXT,
      source_excerpt     TEXT NOT NULL DEFAULT '',
      confidence         REAL NOT NULL DEFAULT 0.65 CHECK(confidence >= 0 AND confidence <= 1),
      importance         INTEGER NOT NULL DEFAULT 3 CHECK(importance >= 1 AND importance <= 5),
      status             TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived', 'deleted')),
      pinned             INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0, 1)),
      content_hash       TEXT NOT NULL UNIQUE,
      metadata_json      TEXT NOT NULL DEFAULT '{}',
      created_at         INTEGER NOT NULL,
      updated_at         INTEGER NOT NULL,
      last_used_at       INTEGER,
      expires_at         INTEGER,
      archived_at        INTEGER
    )`,
    `CREATE INDEX IF NOT EXISTS idx_agent_memories_active_scope
      ON agent_memories(status, scope, updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_memories_workspace
      ON agent_memories(workspace_path, status, importance DESC, updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_memories_session
      ON agent_memories(session_id, status, updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_memories_kind
      ON agent_memories(kind, status, importance DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_memories_expiry
      ON agent_memories(expires_at)
      WHERE expires_at IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS agent_memory_events (
      id          TEXT PRIMARY KEY,
      memory_id   TEXT NOT NULL REFERENCES agent_memories(id) ON DELETE CASCADE,
      event_type  TEXT NOT NULL CHECK(event_type IN (
                    'created',
                    'updated',
                    'retrieved',
                    'reinforced',
                    'archived',
                    'deleted',
                    'expired'
                  )),
      session_id  TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      message_id  TEXT REFERENCES messages(id) ON DELETE SET NULL,
      note        TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_agent_memory_events_memory
      ON agent_memory_events(memory_id, created_at DESC)`,
    `CREATE VIRTUAL TABLE IF NOT EXISTS agent_memory_fts USING fts5(
      memory_id UNINDEXED,
      title,
      content,
      summary,
      tags,
      tokenize = 'unicode61 remove_diacritics 2'
    )`,
    `CREATE TRIGGER IF NOT EXISTS trg_agent_memories_ai
      AFTER INSERT ON agent_memories BEGIN
        INSERT INTO agent_memory_fts(memory_id, title, content, summary, tags)
        VALUES (new.id, new.title, new.content, new.summary, new.tags_json);
      END`,
    `CREATE TRIGGER IF NOT EXISTS trg_agent_memories_au
      AFTER UPDATE OF title, content, summary, tags_json ON agent_memories BEGIN
        DELETE FROM agent_memory_fts WHERE memory_id = old.id;
        INSERT INTO agent_memory_fts(memory_id, title, content, summary, tags)
        VALUES (new.id, new.title, new.content, new.summary, new.tags_json);
      END`,
    `CREATE TRIGGER IF NOT EXISTS trg_agent_memories_ad
      AFTER DELETE ON agent_memories BEGIN
        DELETE FROM agent_memory_fts WHERE memory_id = old.id;
      END`
  ],
  5: [
    // 流式/中断消息元数据（streaming、incomplete）
    `ALTER TABLE messages ADD COLUMN meta_json TEXT`
  ],
  6: [
    `CREATE TABLE IF NOT EXISTS code_agent_state (
      id                 TEXT PRIMARY KEY,
      active_session_id  TEXT NOT NULL,
      mode               TEXT NOT NULL,
      effort             TEXT NOT NULL,
      updated_at         INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS code_agent_sessions (
      id                           TEXT PRIMARY KEY,
      title                        TEXT NOT NULL,
      title_source                 TEXT NOT NULL,
      conversation_id              TEXT NOT NULL,
      last_user_text               TEXT NOT NULL DEFAULT '',
      reviewed_change_signatures   TEXT NOT NULL DEFAULT '[]',
      created_at                   INTEGER NOT NULL,
      updated_at                   INTEGER NOT NULL,
      archived                     INTEGER NOT NULL DEFAULT 0,
      pinned                       INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS idx_code_agent_sessions_updated
      ON code_agent_sessions(archived, pinned DESC, updated_at DESC)`,
    `CREATE TABLE IF NOT EXISTS code_agent_turns (
      id           TEXT PRIMARY KEY,
      session_id   TEXT NOT NULL REFERENCES code_agent_sessions(id) ON DELETE CASCADE,
      user_text    TEXT NOT NULL DEFAULT '',
      parts_json   TEXT NOT NULL DEFAULT '[]',
      run_summary  TEXT,
      created_at   INTEGER NOT NULL,
      streaming    INTEGER NOT NULL DEFAULT 0,
      incomplete   INTEGER NOT NULL DEFAULT 0,
      sort_order   INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS idx_code_agent_turns_session_order
      ON code_agent_turns(session_id, sort_order, created_at)`
  ],
  7: [
    `CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id                 TEXT PRIMARY KEY,
      title              TEXT NOT NULL,
      prompt             TEXT NOT NULL,
      project_id         TEXT REFERENCES projects(id) ON DELETE SET NULL,
      project_name       TEXT,
      timezone           TEXT NOT NULL DEFAULT 'UTC',
      cadence            TEXT NOT NULL CHECK(cadence IN ('once', 'daily', 'weekly', 'workdays', 'monthly', 'custom')),
      schedule_text      TEXT NOT NULL DEFAULT '',
      next_run_at        INTEGER,
      last_run_at        INTEGER,
      status             TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'archived')),
      source             TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('chat', 'template', 'manual', 'system')),
      source_session_id  TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      metadata_json      TEXT NOT NULL DEFAULT '{}',
      created_at         INTEGER NOT NULL,
      updated_at         INTEGER NOT NULL,
      archived_at        INTEGER
    )`,
    `CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_status_next
      ON scheduled_tasks(status, next_run_at)`,
    `CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_updated
      ON scheduled_tasks(status, updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_project
      ON scheduled_tasks(project_id, status, updated_at DESC)`
  ],
  8: [
    `ALTER TABLE code_agent_state ADD COLUMN active_session_ids_by_workspace TEXT`,
    `ALTER TABLE code_agent_sessions ADD COLUMN workspace_name TEXT`,
    `ALTER TABLE code_agent_sessions ADD COLUMN workspace_path TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_code_agent_sessions_workspace
      ON code_agent_sessions(workspace_path, archived, pinned DESC, updated_at DESC)`
  ],
  9: [
    `ALTER TABLE scheduled_tasks ADD COLUMN run_mode TEXT NOT NULL DEFAULT 'notify'
      CHECK(run_mode IN ('notify', 'auto'))`,
    `ALTER TABLE scheduled_tasks ADD COLUMN pending_run_at INTEGER`,
    `ALTER TABLE scheduled_tasks ADD COLUMN last_run_status TEXT
      CHECK(last_run_status IN ('ok', 'error', 'skipped'))`,
    `CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_pending
      ON scheduled_tasks(status, pending_run_at, next_run_at)`
  ],
  10: [
    `CREATE TABLE IF NOT EXISTS scheduled_task_runs (
      id          TEXT PRIMARY KEY,
      task_id     TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
      status      TEXT NOT NULL CHECK(status IN ('ok', 'error', 'skipped')),
      trigger     TEXT NOT NULL DEFAULT 'manual',
      note        TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_task
      ON scheduled_task_runs(task_id, created_at DESC)`
  ],
  11: [
    `ALTER TABLE scheduled_tasks ADD COLUMN remind_at INTEGER`,
    `CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_remind
      ON scheduled_tasks(status, pending_run_at, remind_at)`
  ],
  12: [
    `CREATE TABLE IF NOT EXISTS agent_runtime_events (
      id             TEXT PRIMARY KEY,
      source         TEXT NOT NULL,
      title          TEXT NOT NULL,
      detail         TEXT NOT NULL DEFAULT '',
      priority       INTEGER NOT NULL DEFAULT 50,
      status         TEXT NOT NULL CHECK(status IN ('queued', 'running', 'done', 'failed', 'skipped')),
      metadata_json  TEXT NOT NULL DEFAULT '{}',
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_agent_runtime_events_status
      ON agent_runtime_events(status, priority DESC, created_at ASC)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_runtime_events_recent
      ON agent_runtime_events(created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS agent_runtime_traces (
      id           TEXT PRIMARY KEY,
      turn_id      TEXT NOT NULL,
      phase        TEXT NOT NULL CHECK(phase IN ('intent', 'context', 'tool', 'action', 'error')),
      title        TEXT NOT NULL,
      detail_json  TEXT NOT NULL DEFAULT '{}',
      created_at   INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_agent_runtime_traces_turn
      ON agent_runtime_traces(turn_id, created_at ASC)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_runtime_traces_recent
      ON agent_runtime_traces(created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS agent_context_audits (
      id             TEXT PRIMARY KEY,
      turn_id        TEXT NOT NULL,
      intent_json    TEXT NOT NULL,
      budget_chars   INTEGER NOT NULL,
      used_chars     INTEGER NOT NULL,
      selected_json  TEXT NOT NULL DEFAULT '[]',
      skipped_json   TEXT NOT NULL DEFAULT '[]',
      created_at     INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_agent_context_audits_recent
      ON agent_context_audits(created_at DESC)`
  ],
  13: [
    // Agent 会话上下文持久化：AgentScope StorageBase 落库，应用重启后恢复完整对话记忆
    `CREATE TABLE IF NOT EXISTS agent_contexts (
      conversation_id  TEXT PRIMARY KEY,
      context_json     TEXT NOT NULL,
      metadata_json    TEXT NOT NULL DEFAULT '{}',
      updated_at       INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_agent_contexts_updated
      ON agent_contexts(updated_at)`,
    // 轮次级文件前像：Agent 写文件前捕获原内容，支持按轮回滚
    `CREATE TABLE IF NOT EXISTS agent_file_checkpoints (
      id               TEXT PRIMARY KEY,
      turn_id          TEXT NOT NULL,
      conversation_id  TEXT NOT NULL DEFAULT '',
      file_path        TEXT NOT NULL,
      existed          INTEGER NOT NULL CHECK(existed IN (0, 1)),
      content          BLOB,
      created_at       INTEGER NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_file_checkpoints_turn_file
      ON agent_file_checkpoints(turn_id, file_path)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_file_checkpoints_conversation
      ON agent_file_checkpoints(conversation_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_file_checkpoints_created
      ON agent_file_checkpoints(created_at)`,
    // Code Agent 轮次关联主进程会话 id（= checkpoint turn_id），用于回滚入口
    `ALTER TABLE code_agent_turns ADD COLUMN agent_session_id TEXT`
  ],
  14: [
    // 模型调用用量：每次 MODEL_CALL_END 一行，供用量面板按天/模型聚合
    `CREATE TABLE IF NOT EXISTS agent_usage (
      id               TEXT PRIMARY KEY,
      conversation_id  TEXT NOT NULL DEFAULT '',
      session_id       TEXT NOT NULL DEFAULT '',
      provider         TEXT NOT NULL DEFAULT '',
      model            TEXT NOT NULL DEFAULT '',
      input_tokens     INTEGER NOT NULL DEFAULT 0,
      output_tokens    INTEGER NOT NULL DEFAULT 0,
      created_at       INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_agent_usage_created
      ON agent_usage(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_usage_conversation
      ON agent_usage(conversation_id, created_at)`
  ],
  15: [
    // 页面变化监控：定时抓取 URL 正文并对比哈希，变化时原生通知 + runtime 事件
    `CREATE TABLE IF NOT EXISTS browser_page_monitors (
      id                TEXT PRIMARY KEY,
      url               TEXT NOT NULL,
      title             TEXT NOT NULL DEFAULT '',
      interval_minutes  INTEGER NOT NULL DEFAULT 30,
      last_hash         TEXT NOT NULL DEFAULT '',
      last_excerpt      TEXT NOT NULL DEFAULT '',
      last_checked_at   INTEGER,
      last_changed_at   INTEGER,
      last_error        TEXT NOT NULL DEFAULT '',
      status            TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused')),
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_browser_page_monitors_status
      ON browser_page_monitors(status, last_checked_at)`
  ],
  16: [
    // 页面监控的 AI 分析闭环：变化时自动向 AI 面板发送分析 prompt
    `ALTER TABLE browser_page_monitors ADD COLUMN ai_analyze INTEGER NOT NULL DEFAULT 0
      CHECK(ai_analyze IN (0, 1))`
  ],
  17: [
    // 记忆强化（mem0/Letta 思路）：记录被检索命中的次数，供检索打分的
    // frequency 提升与遗忘淘汰的综合价值分使用。历史记忆默认 0。
    `ALTER TABLE agent_memories ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0`
  ],
  18: [
    // ContextBuilder Manifest：每轮明确上下文来源、预算、选中/跳过原因，供 Brain UI 审计。
    `CREATE TABLE IF NOT EXISTS agent_context_manifests (
      id             TEXT PRIMARY KEY,
      turn_id        TEXT NOT NULL,
      source         TEXT NOT NULL,
      intent_json    TEXT NOT NULL,
      budget_chars   INTEGER NOT NULL,
      used_chars     INTEGER NOT NULL,
      sources_json   TEXT NOT NULL DEFAULT '[]',
      tools_json     TEXT NOT NULL DEFAULT '[]',
      created_at     INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_agent_context_manifests_recent
      ON agent_context_manifests(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_context_manifests_turn
      ON agent_context_manifests(turn_id)`
  ]
}
