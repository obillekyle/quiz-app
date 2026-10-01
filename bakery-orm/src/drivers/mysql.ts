/**
 * MySQL on Node, through mysql2, shaped like Bun's `SQL` client.
 *
 * The options are the measured difference between the two. The same probe
 * ran through Bun 1.4.2 and mysql2 3.24.5 against MySQL 8.4:
 *
 * - `supportBigNumbers` on, `bigNumberStrings` off. Bun returns a BIGINT as a
 *   number when it is exact and as a string past 2^53; that is this pair.
 *   COUNT(*) comes back a number, SUM and AVG and DECIMAL strings, on both.
 * - `timezone: 'Z'` plus `SET time_zone = '+00:00'` on every new connection.
 *   Bun runs its sessions in UTC: a Date bound to a DATETIME is stored as its
 *   UTC wall clock (`2026-01-02 03:04:05`) and read back as UTC. mysql2's
 *   default is the machine's zone, which stored the same Date eight hours
 *   later on this machine. The session zone matters too: it is what
 *   `CURRENT_TIMESTAMP` and a TIMESTAMP column convert through.
 * - `FOUND_ROWS` off. An `UPDATE` that sets a value to what it already was
 *   reports 0 affected rows on Bun; mysql2 asks for found rows by default and
 *   reports the matches instead.
 * - Statements with parameters go through `execute()`, the binary protocol
 *   Bun uses, and those without through `query()`. With parameters,
 *   `query()` is the wrong one: it formats on the client and turns an object
 *   into `[object Object]` and an array into a list, where `execute()` sends
 *   both as JSON exactly as Bun does.
 * - `maxPreparedStatements: 256`. Every distinct statement text `execute()`
 *   sees is prepared on the server and cached on the connection, and MySQL
 *   refuses the 16,383rd prepared statement across all sessions
 *   (`max_prepared_stmt_count`). mysql2's default cache is 16,000 per
 *   connection, so one pool of ten could exhaust the server alone. 256 per
 *   connection keeps a pool of 63 under the limit.
 *
 * A result is reshaped to Bun's: rows with `count` for a read, an empty
 * array with `count: 0`, `affectedRows` and `lastInsertRowid` for a write.
 *
 * One mysql2 behavior is not matched: a cached statement keeps the column
 * types of its first run, so `SELECT ? AS v` run with a Date and then with a
 * number parses the number as a DATETIME. It needs a result column whose type
 * comes from a parameter, which nothing the ORM generates has.
 */
import type * as mysql from 'mysql2/promise'
import type { PoolOptions } from '../pool.js'
import { peer } from './peer.js'
import type { SqlClient, SqlResult } from './types.js'

type MysqlModule = typeof mysql
type Runner = mysql.Pool | mysql.PoolConnection

/**
 * The connection URL, as mysql2 options.
 *
 * Parsed here rather than handed to mysql2, which copies every query
 * parameter into its options: `sslmode` is the parameter the ORM's own
 * documentation uses (Bun needs it to reach MySQL 8 at all), and mysql2
 * would warn that it is invalid and connect without TLS.
 */
export function mysqlOptionsFromUrl(target: string): mysql.PoolOptions {
  const url = new URL(target)
  const options: Record<string, unknown> = {
    host: url.hostname.replace(/^\[|\]$/g, '') || 'localhost',
    port: url.port ? Number(url.port) : 3306,
  }
  if (url.username) options.user = decodeURIComponent(url.username)
  if (url.password) options.password = decodeURIComponent(url.password)
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (database) options.database = database

  for (const [key, value] of url.searchParams) {
    if (key === 'sslmode') options.ssl = sslFor(value)
    else if (key === 'ssl' || key === 'tls') {
      options.ssl = value === 'false' || value === '0' ? undefined : sslFor('require')
    } else {
      // The rest goes to mysql2 the way its own URL parser would send it.
      options[key] = parseValue(value)
    }
  }
  return options as mysql.PoolOptions
}

function parseValue(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    // Not JSON, so a plain string, which is what mysql2's parser falls back
    // to as well.
    return value
  }
}

/**
 * `sslmode` as libpq spells it, which is how Bun reads it for MySQL too.
 *
 * `prefer` is not quite kept: mysql2 has no "TLS if the server offers it", so
 * it is `require`, and a server without TLS refuses the connection rather
 * than accepting it in the clear.
 */
function sslFor(mode: string): mysql.SslOptions | undefined {
  switch (mode) {
    case 'disable':
      return undefined
    case 'allow':
    case 'prefer':
    case 'require':
      return { rejectUnauthorized: false }
    // mysql2 checks the host name only when `verifyIdentity` says so, which is
    // the whole difference between these two.
    case 'verify-ca':
      return { rejectUnauthorized: true, verifyIdentity: false }
    case 'verify-full':
      return { rejectUnauthorized: true, verifyIdentity: true }
    default:
      throw new Error(
        `Unknown sslmode '${mode}'. Use disable, prefer, require, verify-ca or verify-full.`,
      )
  }
}

export function openNodeMysql(target: string | undefined, pool: PoolOptions): SqlClient {
  const driver = peer<MysqlModule>('mysql2/promise', 'A MySQL database')
  const options: mysql.PoolOptions = {
    ...(target ? mysqlOptionsFromUrl(target) : {}),
    supportBigNumbers: true,
    bigNumberStrings: false,
    timezone: 'Z',
    flags: ['-FOUND_ROWS'],
    maxPreparedStatements: 256,
  }
  if (pool.max !== undefined) options.connectionLimit = pool.max
  if (pool.connectionTimeout !== undefined) options.connectTimeout = pool.connectionTimeout * 1000
  if (pool.idleTimeout !== undefined) {
    // mysql2 only retires idle connections above `maxIdle`, which defaults to
    // the whole pool. Bun's idle timeout retires every idle connection.
    options.maxIdle = 0
    options.idleTimeout = pool.idleTimeout * 1000
  }
  // `maxLifetime` has no mysql2 counterpart, so it does nothing on Node.

  const created = driver.createPool(options)
  created.pool.on('connection', connection => {
    // Queued ahead of whatever acquired the connection, so no statement ever
    // runs in the server's zone. A connection that cannot be put in UTC is
    // not used at all.
    connection.query("SET time_zone = '+00:00'", (error: unknown) => {
      if (error) connection.destroy()
    })
  })
  return new MysqlClient(created, null)
}

function reshape(result: unknown): SqlResult {
  if (Array.isArray(result)) {
    const rows = result as SqlResult
    rows.count = rows.length
    rows.command = null
    rows.lastInsertRowid = 0
    rows.affectedRows = 0
    return rows
  }
  const header = result as mysql.ResultSetHeader
  const out: SqlResult = []
  out.count = 0
  out.command = null
  out.lastInsertRowid = header.insertId
  out.affectedRows = header.affectedRows
  return out
}

/**
 * Savepoint names, unique for the life of the process. A counter per handle
 * would hand a savepoint inside a savepoint the name of the one around it,
 * and MySQL answers a repeated name by silently replacing the first.
 */
let savepointSeq = 0

class MysqlClient implements SqlClient {
  closed = false

  constructor(
    private readonly runner: Runner,
    private readonly parent: MysqlClient | null,
  ) {}

  private check(): void {
    if (this.closed) {
      throw new Error('This transaction has ended; its handle cannot run statements.')
    }
  }

  async unsafe(text: string, params: unknown[] = []): Promise<SqlResult> {
    this.check()
    if (params.length === 0) {
      const [result] = await this.runner.query(text)
      return reshape(result)
    }
    // mysql2 refuses `undefined`; Bun binds it as NULL.
    const values = params.map(p => (p === undefined ? null : p))
    const [result] = await this.runner.execute(text, values as mysql.ExecuteValues)
    return reshape(result)
  }

  async transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
    if (this.parent) {
      throw new Error('cannot call begin inside a transaction use savepoint() instead')
    }
    const connection = await (this.runner as mysql.Pool).getConnection()
    const tx = new MysqlClient(connection, this)
    let broken = false
    try {
      await connection.query('BEGIN')
      const result = await fn(tx)
      await connection.query('COMMIT')
      return result
    } catch (error) {
      try {
        await connection.query('ROLLBACK')
      } catch {
        // The connection could not even roll back, so its state is unknown:
        // it is destroyed below rather than handed to the next caller. The
        // caller's error is the one that explains what happened.
        broken = true
      }
      throw error
    } finally {
      tx.closed = true
      if (broken) connection.destroy()
      else connection.release()
    }
  }

  async savepoint<T>(fn: (sp: SqlClient) => Promise<T>): Promise<T> {
    this.check()
    if (!this.parent) return await this.transaction(fn)
    const name = `bakery_sp_${++savepointSeq}`
    const sp = new MysqlClient(this.runner, this)
    await this.runner.query(`SAVEPOINT ${name}`)
    try {
      const result = await fn(sp)
      await this.runner.query(`RELEASE SAVEPOINT ${name}`)
      return result
    } catch (error) {
      await this.runner.query(`ROLLBACK TO SAVEPOINT ${name}`)
      await this.runner.query(`RELEASE SAVEPOINT ${name}`)
      throw error
    } finally {
      sp.closed = true
    }
  }

  async close(): Promise<void> {
    if (!this.parent) await (this.runner as mysql.Pool).end()
  }
}
