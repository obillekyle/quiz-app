/**
 * Which SQL client an adapter talks to.
 *
 * On Bun it is Bun's own `SQL`, exactly as in bakery, so nothing about the
 * Bun path changed in the copy. Everywhere else it is a Node driver shaped
 * like it: `node:sqlite`, postgres.js or mysql2.
 *
 * `BAKERY_ORM_DRIVERS=node` picks the Node drivers on Bun as well. It is
 * there for the test suite, so the same tests run against both sets of
 * drivers without a second suite, and it is read on every open, so a test
 * can switch it between adapters.
 */
import type { PoolOptions } from '../pool.js'
import { openNodeMysql } from './mysql.js'
import { openNodePostgres } from './postgres.js'
import { NodeSqliteClient } from './sqlite.js'
import type { SqlClient } from './types.js'

export type { SqlClient, SqlResult } from './types.js'

type BunSqlConstructor = new (...args: unknown[]) => SqlClient

function bunSql(): BunSqlConstructor | null {
  if (process.env.BAKERY_ORM_DRIVERS === 'node') return null
  // Through `unknown`: Bun declares no `savepoint` on a root `SQL`, though one is
  // there at runtime (bakery verified it on all three dialects, 1.3.14).
  const bun = (globalThis as unknown as { Bun?: { SQL?: BunSqlConstructor } }).Bun
  return bun?.SQL ?? null
}

/** `'bun'` or `'node'`: which drivers the next connection will open. */
export function driverRuntime(): 'bun' | 'node' {
  return bunSql() ? 'bun' : 'node'
}

export function openSqlite(filename: string): SqlClient {
  const SQL = bunSql()
  if (!SQL) return new NodeSqliteClient(filename)
  return filename === ':memory:'
    ? new SQL('sqlite://:memory:')
    : new SQL(filename, { adapter: 'sqlite' })
}

export function openPostgres(target: string | undefined, pool: PoolOptions): SqlClient {
  const SQL = bunSql()
  if (!SQL) return openNodePostgres(target, pool)
  return target ? new SQL(target, { ...pool }) : new SQL({ ...pool })
}

export function openMysql(target: string | undefined, pool: PoolOptions): SqlClient {
  const SQL = bunSql()
  if (!SQL) return openNodeMysql(target, pool)
  return target ? new SQL(target, { ...pool }) : new SQL({ ...pool })
}
