/**
 * The slice of Bun's `SQL` client the adapters use, so a Node driver can
 * stand in for it.
 *
 * Four calls, all of them read off the adapters rather than off Bun's
 * documentation: `unsafe(text, params)`, `transaction(fn)` on a root
 * connection, `savepoint(fn)` inside one, and `close()`.
 */
export interface SqlResult extends Array<any> {
  /** Rows affected by a write, or rows returned by a read. */
  count?: number | null
  /** The statement's first keyword: `INSERT`, `SELECT`, `CREATE TABLE`... */
  command?: string | null
  lastInsertRowid?: number | bigint | null
  /** MySQL only. Bun's MySQL client reports a write's count here. */
  affectedRows?: number | null
}

export interface SqlClient {
  unsafe(text: string, params?: unknown[]): Promise<SqlResult>
  transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T>
  savepoint<T>(fn: (sp: SqlClient) => Promise<T>): Promise<T>
  close(): Promise<void>
}

/**
 * Which client `openSqlite` and the other two hand back. `auto` is Bun's own
 * `SQL` on Bun and the Node driver everywhere else; `node` forces the Node
 * driver on Bun too, which is how the suite runs the Node drivers under
 * `bun test` (`BAKERY_ORM_DRIVERS=node`).
 */
export type DriverChoice = 'auto' | 'bun' | 'node'
