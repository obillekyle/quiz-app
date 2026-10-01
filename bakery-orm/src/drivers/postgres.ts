/**
 * Postgres on Node, through postgres.js, shaped like Bun's `SQL` client.
 *
 * Little to do: Bun's client was modeled on this one, and the same probe run
 * through both (Bun 1.4.2, postgres.js 3.4.9) came back the same for every
 * column type the ORM writes. BIGINT, NUMERIC and COUNT(*) are strings,
 * INTEGER and DOUBLE PRECISION numbers, JSONB parsed, BYTEA a Buffer,
 * TIMESTAMPTZ a Date; `count` and `command` match, and so does a JSON column
 * given a string (stored as a JSON string, not parsed).
 *
 * Three options close the rest of the gap:
 *
 * - `transform.undefined: null`. Bun binds `undefined` as NULL; postgres.js
 *   refuses it with `UNDEFINED_VALUE`.
 * - `onnotice` silenced. Bun prints no server notices; postgres.js logs every
 *   one, which is a line per `DROP TABLE IF EXISTS` during a sync.
 * - The pool sizes, renamed. The ORM's `PoolOptions` are in seconds, which is
 *   postgres.js's unit as well as Bun's.
 *
 * What still differs is an untyped parameter read straight back
 * (`SELECT $1`): Bun returns a number as a number and a Date as its
 * `toString()`, postgres.js returns the number as text and the Date as a
 * Date. Nothing the ORM generates selects a bare parameter.
 */
import type postgres from 'postgres'
import type { PoolOptions } from '../pool.js'
import { peer } from './peer.js'
import type { SqlClient, SqlResult } from './types.js'

type Connect = typeof postgres
type Handle = postgres.Sql | postgres.TransactionSql

export function openNodePostgres(target: string | undefined, pool: PoolOptions): SqlClient {
  // The CommonJS build is the function itself. Bun resolves the package's
  // `bun` condition, an ES module, and hands `require` its namespace instead.
  const loaded = peer<Connect | { default: Connect }>('postgres', 'A Postgres database')
  const connect = typeof loaded === 'function' ? loaded : loaded.default
  const options: postgres.Options<{}> = {
    onnotice: () => {},
    transform: { undefined: null },
  }
  // Only what was set: an option left out is postgres.js's own default, which
  // is not the same thing as passing it `undefined`.
  if (pool.max !== undefined) options.max = pool.max
  if (pool.idleTimeout !== undefined) options.idle_timeout = pool.idleTimeout
  if (pool.connectionTimeout !== undefined) options.connect_timeout = pool.connectionTimeout
  if (pool.maxLifetime !== undefined) options.max_lifetime = pool.maxLifetime

  return new PostgresClient(target ? connect(target, options) : connect(options), null)
}

class PostgresClient implements SqlClient {
  closed = false

  /** `parent` is null on the root connection and set on every transaction. */
  constructor(
    private readonly handle: Handle,
    private readonly parent: PostgresClient | null,
  ) {}

  private check(): void {
    if (this.closed) {
      throw new Error('This transaction has ended; its handle cannot run statements.')
    }
  }

  async unsafe(text: string, params: unknown[] = []): Promise<SqlResult> {
    this.check()
    return (await this.handle.unsafe(text, params as postgres.ParameterOrJSON<never>[])) as SqlResult
  }

  async transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
    if (this.parent) {
      throw new Error('cannot call begin inside a transaction use savepoint() instead')
    }
    return (await (this.handle as postgres.Sql).begin(tx => this.child(tx, fn))) as T
  }

  async savepoint<T>(fn: (sp: SqlClient) => Promise<T>): Promise<T> {
    this.check()
    // On the root connection a savepoint has no transaction to sit in, so it
    // is one: the same answer `SAVEPOINT` outside a transaction gets.
    if (!this.parent) return await this.transaction(fn)
    return (await (this.handle as postgres.TransactionSql).savepoint(sp => this.child(sp, fn))) as T
  }

  private async child<T>(handle: postgres.TransactionSql, fn: (tx: SqlClient) => Promise<T>): Promise<T> {
    const tx = new PostgresClient(handle, this)
    try {
      return await fn(tx)
    } finally {
      tx.closed = true
    }
  }

  async close(): Promise<void> {
    // A transaction's connection belongs to the pool, which the root closes.
    if (!this.parent) await (this.handle as postgres.Sql).end()
  }
}
