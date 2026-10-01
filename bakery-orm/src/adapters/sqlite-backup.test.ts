import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SQLiteAdapter } from './sqlite.js'

/**
 * A backup has to hold what the database holds, including what is still in
 * the write-ahead log.
 *
 * It was a copy of the main file, and in WAL mode (the default since the
 * journal-mode change) a commit lives in `-wal` until a checkpoint moves it
 * across, which SQLite does every 1,000 pages. Measured with bakery 2.0.4's
 * adapter on Bun and with this package on both drivers: a table created and
 * filled with 50 rows, then backed up, gave a file with no table in it at
 * all. That is the copy schema sync takes before a destructive migration.
 */
const dir = mkdtempSync(join(tmpdir(), 'bakery-orm-backup-'))
afterAll(() => {
  // Under `BAKERY_ORM_DRIVERS=node` this is Bun's `node:sqlite`, which keeps a
  // closed database's file open until its statements are collected (see
  // `NodeSqliteClient.close`). The collection there can miss one still on the
  // stack, so this one runs from a fresh frame, and the delete retries.
  Bun.gc(true)
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

test('a backup taken in WAL mode holds every committed row', async () => {
  const db = new SQLiteAdapter(join(dir, 'app.db').replace(/\\/g, '/'))
  await db.query('CREATE TABLE t (v INTEGER)').run()
  for (let i = 0; i < 50; i++) await db.query('INSERT INTO t VALUES (?)').run(i)
  expect(((await db.query('PRAGMA journal_mode').get()) as { journal_mode: string }).journal_mode).toBe('wal')

  const result = await db.backup(5)
  await db.close()
  expect(result).not.toBeNull()

  const copy = new SQLiteAdapter(join(dir, 'backups', result!.file).replace(/\\/g, '/'))
  try {
    const row = await copy.query('SELECT count(*) AS n, sum(v) AS total FROM t').get()
    expect(row).toEqual({ n: 50, total: 1225 })
  } finally {
    await copy.close()
  }
})
