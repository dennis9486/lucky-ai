import Database from 'better-sqlite3'
import { join } from 'node:path'
import { app } from 'electron'
import { CURRENT_SCHEMA_VERSION, MIGRATIONS } from './migrations.js'

let instance: DatabaseService | null = null

export class DatabaseService {
  readonly db: Database.Database

  private constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('busy_timeout = 5000')
    this.runMigrations()
  }

  static getInstance(): DatabaseService {
    if (!instance) {
      const dbPath = join(app.getPath('userData'), 'lucky-ai.db')
      instance = new DatabaseService(dbPath)
    }
    return instance
  }

  static close(): void {
    instance?.db.close()
    instance = null
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }

  private runMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     INTEGER PRIMARY KEY,
        applied_at  INTEGER NOT NULL
      )
    `)

    const applied = new Set(
      this.db.prepare('SELECT version FROM schema_migrations').all().map((r) => (r as { version: number }).version)
    )

    for (let v = 1; v <= CURRENT_SCHEMA_VERSION; v++) {
      if (applied.has(v)) continue
      const statements = MIGRATIONS[v]
      if (!statements) continue

      this.transaction(() => {
        for (const sql of statements) {
          this.db.exec(sql)
        }
        this.db
          .prepare('INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)')
          .run(v, Date.now())
      })
    }
  }
}
