/**
 * node:sqlite 的最小类型声明 — 仅供 vitest（node 环境）使用。
 *
 * 背景：项目 @types/node 为 v20，尚无 node:sqlite 内置声明；而 better-sqlite3
 * 的原生绑定按 Electron ABI 编译，node 测试进程无法加载。测试改用运行时
 * Node（≥22.5）内置的 node:sqlite 作为 Database 替身，这里只声明用到的最小面。
 * 生产代码一律使用 better-sqlite3，不得引用本模块。
 */
declare module 'node:sqlite' {
  interface StatementSync {
    all(...params: unknown[]): unknown[]
    get(...params: unknown[]): unknown
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint }
  }

  class DatabaseSync {
    constructor(path: string)
    exec(sql: string): void
    prepare(sql: string): StatementSync
    close(): void
  }

  export { DatabaseSync, StatementSync }
}
