/**
 * SQLite on Node, through `node:sqlite`, shaped like Bun's `SQL` client.
 *
 * Every rule below was read off Bun 1.4.2 by running the same statements
 * through both, so it is a copy of a measurement rather than of the
 * documentation:
 *
 * - **Parameters.** Bun binds `true`/`false` as 1/0 and `undefined` as NULL,
 *   and refuses a `Date`, a plain object or an array with a `TypeError`.
 *   `node:sqlite` refuses booleans and `undefined` outright, so they are
 *   converted. A `Date` has to be refused *here*: passed through, `node:sqlite`
 *   reads any object in first position as a table of named parameters, and a
 *   `Date` has no keys, so it binds nothing and the placeholder is NULL. No
 *   error anywhere.
 * - **Integers.** `node:sqlite` binds every JavaScript number as REAL, so `42`
 *   arrives as `42.0`: in a TEXT column that is the string `'42.0'`, and a
 *   TEXT `'42'` no longer equals it. Bun binds an integer-valued number as
 *   INTEGER. Safe integers therefore go in as `BigInt`, which `node:sqlite`
 *   binds as INTEGER. `-0` and 2^53 stay REAL, as they do on Bun.
 * - **Results.** A read returns the rows with `count` set to their number; a
 *   write returns an empty array with `count` set to the changes and
 *   `lastInsertRowid`. `command` is the statement's first word.
 * - **One statement per call.** `node:sqlite` compiles the first statement of
 *   a string and drops the rest without a word. Bun runs the rest of a DDL
 *   string and drops the rest of a DML one. Neither is safe to copy, so text
 *   holding a second statement is refused; trailing comments and semicolons
 *   are fine.
 *
 * Two differences are kept on purpose. A row comes back with a null
 * prototype, as `node:sqlite` builds it: the query builder copies every row
 * into a plain object anyway, so copying here would be paid twice. And an
 * INTEGER past 2^53 throws `ERR_OUT_OF_RANGE` on read, where Bun returns it
 * rounded to the nearest double.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { SqlClient, SqlResult } from './types.js'

/** The message Bun's SQLite client gives for a value it cannot bind. */
const BIND_REFUSED = 'Binding expected string, TypedArray, boolean, number, bigint or null'

export function toSqliteParam(value: unknown): SQLInputValue {
  switch (typeof value) {
    case 'string':
    case 'bigint':
      return value
    case 'number':
      return Number.isSafeInteger(value) && !Object.is(value, -0) ? BigInt(value) : value
    case 'boolean':
      return value ? 1 : 0
    case 'undefined':
      return null
  }
  if (value === null || ArrayBuffer.isView(value)) {
    if (value instanceof DataView) throw new TypeError(BIND_REFUSED)
    return value as SQLInputValue
  }
  throw new TypeError(BIND_REFUSED)
}

/**
 * Skips whitespace, `-- line` comments and `/* block *\/` comments, and
 * semicolons between statements. Returns where the next real token starts.
 */
function skipTrivia(text: string, from: number): number {
  let i = from
  while (i < text.length) {
    const c = text[i]
    if (c === ';' || c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f') {
      i++
    } else if (c === '-' && text[i + 1] === '-') {
      const end = text.indexOf('\n', i + 2)
      i = end === -1 ? text.length : end + 1
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? text.length : end + 2
    } else {
      break
    }
  }
  return i
}

function commandOf(text: string): string | null {
  const start = skipTrivia(text, 0)
  const word = /^[A-Za-z]+/.exec(text.slice(start, start + 16))?.[0]
  return word ? word.toUpperCase() : null
}

/**
 * Who is waiting on whom while a transaction is open.
 *
 * SQLite here is one connection, so a transaction is a property of the whole
 * handle: any statement issued while one is open runs inside it, and goes
 * with it on rollback. Bun's client does exactly that, measured: a root
 * `INSERT` issued while another caller's transaction was open ran at once and
 * was rolled back with a transaction it had no part in.
 *
 * So a statement from anywhere else waits for the transaction to finish. A
 * statement from *inside* the transaction's own async context does not: that
 * is the transaction's callback reaching for the root handle, and making it
 * wait for the transaction it is part of would hang both forever.
 */
class TransactionGate {
  private open: { token: object; done: Promise<void> } | null = null
  private readonly context = new AsyncLocalStorage<object>()

  /**
   * What a statement on the root handle has to wait for, or `null` when it
   * may run now.
   *
   * Callers loop on this and then run in the same synchronous step. An async
   * helper that waited and then returned puts a microtask between the last
   * check and the statement, and a transaction can open in that gap: the
   * first version of this gate was that helper, and its regression test
   * (`sqlite.test.ts`) caught a root INSERT queued in the same tick as a
   * BEGIN running inside that transaction and rolling back with it, and two
   * transactions opened in one tick nesting.
   */
  get blocker(): Promise<void> | null {
    return this.open && this.context.getStore() !== this.open.token ? this.open.done : null
  }

  /**
   * Runs `body` as the open transaction. The caller has already found no
   * blocker, in the same synchronous step: `open` is set before the first
   * `await` here, and `body` runs its BEGIN before its own.
   */
  async hold<T>(body: () => Promise<T>): Promise<T> {
    const token = {}
    let release!: () => void
    this.open = { token, done: new Promise<void>(resolve => (release = resolve)) }
    try {
      return await this.context.run(token, body)
    } finally {
      this.open = null
      release()
    }
  }

  /** Is this call already part of the open transaction? */
  get inside(): boolean {
    return this.open !== null && this.context.getStore() === this.open.token
  }
}

export class NodeSqliteClient implements SqlClient {
  private readonly db: DatabaseSync
  private readonly gate = new TransactionGate()
  private savepoints = 0

  constructor(filename: string) {
    this.db = new DatabaseSync(filename)
    // `columns()` is how a read is told from a write, and Node added it in
    // 23.11 (22.22.1 has it; earlier 22.x releases are untested). Without it
    // the first query would fail with "columns is not a function".
    if (typeof this.db.prepare('SELECT 1').columns !== 'function') {
      this.db.close()
      throw new Error(
        `bakery-orm's SQLite driver needs Node 22.22 or later (StatementSync.columns); this is Node ${process.version}.`,
      )
    }
  }

  /** The statement itself, with no waiting. Every public path waits first. */
  run(text: string, params: unknown[]): SqlResult {
    const stmt = this.db.prepare(text)
    const rest = text.slice(stmt.sourceSQL.length)
    if (skipTrivia(rest, 0) < rest.length) {
      throw new Error(
        'SQLite runs one statement per call, and this text holds more than one. ' +
          `Split it and run each in turn: ${JSON.stringify(rest.trim().slice(0, 60))}...`,
      )
    }
    const values = params.map(toSqliteParam)
    const command = commandOf(text)

    if (stmt.columns().length > 0) {
      const rows = stmt.all(...values) as unknown as SqlResult
      rows.count = rows.length
      rows.command = command
      rows.lastInsertRowid = null
      return rows
    }
    const info = stmt.run(...values)
    const result: SqlResult = []
    result.count = Number(info.changes)
    result.command = command
    result.lastInsertRowid = info.lastInsertRowid
    return result
  }

  async unsafe(text: string, params: unknown[] = []): Promise<SqlResult> {
    for (let wait = this.gate.blocker; wait; wait = this.gate.blocker) await wait
    return this.run(text, params)
  }

  async transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
    for (let wait = this.gate.blocker; wait; wait = this.gate.blocker) await wait
    if (this.gate.inside) {
      // The same thing SQLite says, said before it has to: this is the root
      // handle being asked for a transaction from inside one.
      throw new Error('cannot start a transaction within a transaction; use savepoint() instead')
    }
    return await this.gate.hold(async () => {
      const tx = new SqliteTransaction(this)
      this.run('BEGIN', [])
      try {
        const result = await fn(tx)
        this.run('COMMIT', [])
        return result
      } catch (error) {
        // A failed ROLLBACK means SQLite already ended the transaction (an
        // I/O error, a full disk): the caller's error is the one that explains
        // it, so that is the one that propagates.
        try {
          this.run('ROLLBACK', [])
        } catch {
          // See above: the original error is rethrown below.
        }
        throw error
      } finally {
        tx.closed = true
      }
    })
  }

  /**
   * On the root handle, a savepoint inside the open transaction is a
   * savepoint, and anywhere else it is a transaction: SQLite's own `SAVEPOINT`
   * outside one opens one, and it has to wait its turn like any other.
   */
  async savepoint<T>(fn: (sp: SqlClient) => Promise<T>): Promise<T> {
    for (let wait = this.gate.blocker; wait; wait = this.gate.blocker) await wait
    return this.gate.inside ? await this.nestedSavepoint(fn) : await this.transaction(fn)
  }

  /** `SAVEPOINT` on the open transaction. Only a transaction handle calls this. */
  async nestedSavepoint<T>(fn: (sp: SqlClient) => Promise<T>): Promise<T> {
    const name = `bakery_sp_${++this.savepoints}`
    const sp = new SqliteTransaction(this)
    this.run(`SAVEPOINT ${name}`, [])
    try {
      const result = await fn(sp)
      this.run(`RELEASE ${name}`, [])
      return result
    } catch (error) {
      this.run(`ROLLBACK TO ${name}`, [])
      this.run(`RELEASE ${name}`, [])
      throw error
    } finally {
      sp.closed = true
    }
  }

  async close(): Promise<void> {
    for (let wait = this.gate.blocker; wait; wait = this.gate.blocker) await wait
    if (!this.db.isOpen) return
    this.db.close()
    // Only when this driver runs inside Bun, which is how the suite tests it.
    // Bun's `node:sqlite` keeps the file open after `close()` for as long as
    // a statement it prepared is uncollected: on Windows, removing the file
    // straight after failed with EBUSY, and succeeded after one forced
    // collection. Node releases the file at `close()` and skips this.
    const bun = (globalThis as { Bun?: { gc?: (force: boolean) => void } }).Bun
    bun?.gc?.(true)
  }
}

/** The handle a transaction or savepoint callback receives. */
class SqliteTransaction implements SqlClient {
  closed = false

  constructor(private readonly root: NodeSqliteClient) {}

  private check(): void {
    if (this.closed) {
      throw new Error('This transaction has ended; its handle cannot run statements.')
    }
  }

  async unsafe(text: string, params: unknown[] = []): Promise<SqlResult> {
    this.check()
    return this.root.run(text, params)
  }

  async transaction<T>(): Promise<T> {
    throw new Error('cannot call begin inside a transaction use savepoint() instead')
  }

  async savepoint<T>(fn: (sp: SqlClient) => Promise<T>): Promise<T> {
    this.check()
    return await this.root.nestedSavepoint(fn)
  }

  async close(): Promise<void> {
    // The root connection owns the file handle; a transaction has nothing of
    // its own to close.
  }
}
