// The flow an app runs, through the built package and the public API only:
// create, read, update, delete, transactions, and the value types that come
// back. Each `*.test.mjs` beside this points DB_URL somewhere and runs it in
// its own process, which `node --test` gives every file.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import DB, { closeDB, initDB } from 'bakery-orm'
import { connection } from 'bakery-orm/connection'

/** The DDL per dialect: the scenario is about queries, not about sync. */
const DDL = {
  sqlite: name =>
    `CREATE TABLE ${name} (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, code TEXT, done BOOLEAN NOT NULL DEFAULT 0, score REAL)`,
  postgres: name =>
    `CREATE TABLE ${name} (id SERIAL PRIMARY KEY, title TEXT NOT NULL, code TEXT, done BOOLEAN NOT NULL DEFAULT FALSE, score DOUBLE PRECISION)`,
  mysql: name =>
    `CREATE TABLE ${name} (id INT AUTO_INCREMENT PRIMARY KEY, title TEXT NOT NULL, code TEXT, done TINYINT(1) NOT NULL DEFAULT 0, score DOUBLE)`,
}

export function scenario(expectedDriver) {
  const table = `bakery_node_${process.pid}`
  let db

  before(async () => {
    db = await initDB()
    assert.equal(db.driver, expectedDriver)
    await db.query(`DROP TABLE IF EXISTS ${table}`).run()
    await db.query(DDL[expectedDriver](table)).run()
  })

  after(async () => {
    await connection.query(`DROP TABLE IF EXISTS ${table}`).run()
    await closeDB()
  })

  test('insert reports its row and the id it was given', async () => {
    const result = await DB.Insert.into(table).values({ title: 'first', code: '42', score: 1.5 }).run()
    assert.equal(result.changes, 1)
    assert.equal(Number(result.lastInsertRowid), 1)
    const many = await DB.Insert.into(table)
      .values({ title: 'second', code: '7' }, { title: 'third', code: null })
      .run()
    assert.equal(many.changes, 2)
  })

  test('select reads rows back, with both spellings of a key', async () => {
    const rows = await DB.from(table).orderBy(`${table}.id`).array()
    assert.deepEqual(
      rows.map(r => r.title),
      ['first', 'second', 'third'],
    )
    const one = await DB.from(table).where(`${table}.code`, '42').fetch()
    assert.equal(one.title, 'first')
    assert.equal(one.score, 1.5)
    const n = await DB.from(table).select({ n: DB.count('*') }).value()
    assert.equal(Number(n), 3)
    assert.equal(await DB.from(table).where(`${table}.code`, DB.isNull()).exists(), true)
  })

  // On SQLite through node:sqlite this was the trap: every number bound as
  // REAL, so 42 met a TEXT column as '42.0' and matched nothing.
  test('a number compared with a TEXT column matches as Bun would bind it', async () => {
    const row = await DB.from(table).where(`${table}.code`, 42).fetch()
    assert.equal(row?.title, 'first')
  })

  test('update and delete report what they changed', async () => {
    const up = await DB.Update.table(table).set({ done: true }).where(`${table}.code`, '7').run()
    assert.equal(up.changes, 1)
    const done = await DB.from(table).where(`${table}.done`, true).column()
    assert.equal(done.length, 1)
    const del = await DB.Delete.from(table).where(`${table}.code`, DB.isNull()).run()
    assert.equal(del.changes, 1)
  })

  test('a transaction commits on return and rolls back on a throw', async () => {
    await DB.transaction(async () => {
      await DB.Insert.into(table).values({ title: 'kept' }).run()
    })
    await assert.rejects(
      DB.transaction(async () => {
        await DB.Insert.into(table).values({ title: 'discarded' }).run()
        throw new Error('roll back')
      }),
      /roll back/,
    )
    const titles = await DB.from(table).select({ t: `${table}.title` }).column()
    assert.ok(titles.includes('kept'))
    assert.ok(!titles.includes('discarded'))
  })

  test('a nested transaction is a savepoint: its failure undoes only itself', async () => {
    await DB.transaction(async () => {
      await DB.Insert.into(table).values({ title: 'outer' }).run()
      await assert.rejects(
        DB.transaction(async () => {
          await DB.Insert.into(table).values({ title: 'inner' }).run()
          throw new Error('inner fails')
        }),
      )
    })
    const titles = await DB.from(table).select({ t: `${table}.title` }).column()
    assert.ok(titles.includes('outer'))
    assert.ok(!titles.includes('inner'))
  })

  test('a statement from outside a transaction is not caught up in its rollback', async () => {
    let release
    const held = new Promise(resolve => (release = resolve))
    const tx = DB.transaction(async () => {
      await DB.Insert.into(table).values({ title: 'in-tx' }).run()
      await held
      throw new Error('roll back')
    }).catch(error => error.message)
    // Started outside the callback, so it belongs to no transaction.
    const outside = DB.Insert.into(table).values({ title: 'outside' }).run()
    release()
    assert.equal(await tx, 'roll back')
    await outside
    const titles = await DB.from(table).select({ t: `${table}.title` }).column()
    assert.ok(titles.includes('outside'))
    assert.ok(!titles.includes('in-tx'))
  })
}
