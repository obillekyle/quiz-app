import { afterEach, describe, expect, test } from 'bun:test'
import { NodeSqliteClient, toSqliteParam } from './sqlite.js'

/**
 * The Node SQLite driver's own rules: the ones bakery's suite cannot see,
 * because they are about this driver rather than about the ORM above it.
 *
 * In memory, deliberately. Nothing here is about the file, and a file is what
 * made this flaky: Bun's `node:sqlite` keeps a closed database's file open
 * until its statements are collected (see `NodeSqliteClient.close`), the
 * cleanup could not delete it in 2 runs of 8, and while the names were built
 * from a list's length the next test then reopened the same leftover file.
 */
const clients: NodeSqliteClient[] = []

function open(): NodeSqliteClient {
  const client = new NodeSqliteClient(':memory:')
  clients.push(client)
  return client
}

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close()
})

const values = async (client: NodeSqliteClient) =>
  (await client.unsafe('SELECT v FROM t ORDER BY rowid')).map(r => r.v)

describe('a statement outside a transaction never runs inside it', () => {
  // Bun's own client fails this one, measured: the root INSERT runs at once,
  // inside the other caller's transaction, and is rolled back with it.
  test('a root statement issued mid-transaction waits, and survives its rollback', async () => {
    const client = open()
    await client.unsafe('CREATE TABLE t (v TEXT)')

    let release!: () => void
    const held = new Promise<void>(resolve => (release = resolve))
    const tx = client
      .transaction(async t => {
        await t.unsafe("INSERT INTO t VALUES ('in-tx')")
        await held
        throw new Error('roll back')
      })
      .catch((error: Error) => error.message)

    const root = client.unsafe("INSERT INTO t VALUES ('root')")
    release()

    expect(await tx).toBe('roll back')
    await root
    expect(await values(client)).toEqual(['root'])
  })

  // The race that a check followed by an `await` leaves open: both calls see
  // no transaction, the transaction's continuation runs first and opens one,
  // and the root statement's continuation then runs inside it.
  test('a root statement queued in the same tick as BEGIN does not join it', async () => {
    const client = open()
    await client.unsafe('CREATE TABLE t (v TEXT)')

    const tx = client
      .transaction(async t => {
        await t.unsafe("INSERT INTO t VALUES ('in-tx')")
        await new Promise(resolve => setTimeout(resolve, 10))
        throw new Error('roll back')
      })
      .catch((error: Error) => error.message)
    const root = client.unsafe("INSERT INTO t VALUES ('root')")

    expect(await tx).toBe('roll back')
    await root
    expect(await values(client)).toEqual(['root'])
  })

  test('the transaction body may still reach for the root handle without hanging', async () => {
    const client = open()
    await client.unsafe('CREATE TABLE t (v TEXT)')
    await client.transaction(async () => {
      await client.unsafe("INSERT INTO t VALUES ('via-root')")
    })
    expect(await values(client)).toEqual(['via-root'])
  })

  test('two transactions take turns rather than nesting', async () => {
    const client = open()
    await client.unsafe('CREATE TABLE t (v TEXT)')
    const order: string[] = []
    await Promise.all(
      ['a', 'b'].map(name =>
        client.transaction(async t => {
          order.push(`${name}:begin`)
          await new Promise(resolve => setTimeout(resolve, 5))
          await t.unsafe('INSERT INTO t VALUES (?)', [name])
          order.push(`${name}:end`)
        }),
      ),
    )
    expect(order).toEqual(['a:begin', 'a:end', 'b:begin', 'b:end'])
    expect(await values(client)).toEqual(['a', 'b'])
  })

  test('a failed savepoint rolls back to itself and nothing more', async () => {
    const client = open()
    await client.unsafe('CREATE TABLE t (v TEXT)')
    await client.transaction(async t => {
      await t.unsafe("INSERT INTO t VALUES ('outer')")
      await t
        .savepoint(async sp => {
          await sp.unsafe("INSERT INTO t VALUES ('inner')")
          throw new Error('undo inner')
        })
        .catch(() => {})
      await t.savepoint(async sp => {
        await sp.savepoint(async deeper => {
          await deeper.unsafe("INSERT INTO t VALUES ('deeper')")
        })
      })
    })
    expect(await values(client)).toEqual(['outer', 'deeper'])
  })

  test('a transaction handle refuses statements once its transaction has ended', async () => {
    const client = open()
    await client.unsafe('CREATE TABLE t (v TEXT)')
    let leaked: { unsafe: NodeSqliteClient['unsafe'] } | undefined
    await client.transaction(async t => {
      leaked = t
    })
    await expect(leaked!.unsafe('SELECT 1')).rejects.toThrow('transaction has ended')
  })
})

describe('results and parameters match what Bun hands back', () => {
  test('a write reports its changes and rowid, a read its rows', async () => {
    const client = open()
    await client.unsafe('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)')
    const insert = await client.unsafe('INSERT INTO t (v) VALUES (?), (?)', ['a', 'b'])
    expect(insert).toHaveLength(0)
    expect(insert.count).toBe(2)
    expect(insert.command).toBe('INSERT')
    expect(insert.lastInsertRowid).toBe(2)

    const rows = await client.unsafe('SELECT id, v FROM t ORDER BY id')
    expect(rows.map(r => ({ ...r }))).toEqual([
      { id: 1, v: 'a' },
      { id: 2, v: 'b' },
    ])
    expect(rows.count).toBe(2)
    expect(rows.command).toBe('SELECT')
    expect(rows.lastInsertRowid).toBeNull()
  })

  test('an integer binds as INTEGER, so a TEXT column stores "42" and not "42.0"', async () => {
    const client = open()
    await client.unsafe('CREATE TABLE t (v TEXT)')
    await client.unsafe('INSERT INTO t VALUES (?)', [42])
    expect(await values(client)).toEqual(['42'])
    const [row] = await client.unsafe('SELECT typeof(?) AS a, typeof(?) AS b, typeof(?) AS c', [7, 1.5, -0])
    expect({ ...row }).toEqual({ a: 'integer', b: 'real', c: 'real' })
  })

  test('booleans bind as 1 and 0, undefined as NULL', () => {
    expect(toSqliteParam(true)).toBe(1)
    expect(toSqliteParam(false)).toBe(0)
    expect(toSqliteParam(undefined)).toBeNull()
  })

  // Passed through, `node:sqlite` reads an object in first position as named
  // parameters: a Date has no keys, binds nothing, and the value is NULL.
  test('a Date, an object or an array is refused rather than bound as NULL', () => {
    for (const value of [new Date(0), { a: 1 }, [1, 2], new DataView(new ArrayBuffer(1))]) {
      expect(() => toSqliteParam(value)).toThrow(TypeError)
    }
  })

  test('a second statement in one string is refused, a trailing comment is not', async () => {
    const client = open()
    await expect(client.unsafe('CREATE TABLE a (x); CREATE TABLE b (y)')).rejects.toThrow(
      'one statement per call',
    )
    expect((await client.unsafe("SELECT name FROM sqlite_master WHERE type = 'table'")).length).toBe(0)
    const rows = await client.unsafe('SELECT 1 AS one; -- a note\n')
    expect(rows[0].one).toBe(1)
  })
})
