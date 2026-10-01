import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after } from 'node:test'
import { scenario } from './scenario.mjs'

const file = join(tmpdir(), `bakery-orm-node-${process.pid}.db`)
process.env.DB_URL = file
scenario('sqlite')
// After the scenario's own `after`, which closes the database: hooks run in
// the order they were registered, and an open file cannot be removed here.
after(() => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${file}${suffix}`, { force: true })
})
