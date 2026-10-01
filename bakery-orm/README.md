# bakery-orm

Bakery's ORM on its own: the query builder, the three database adapters and
schema sync from `@bakery-framework/orm` 2.0.4, running on Bun and on Node.

On Bun it talks to Bun's own `SQL` client, exactly as bakery does. On Node it
talks to `node:sqlite`, postgres.js or mysql2, each shaped to hand back what
Bun's client hands back: the same value types, the same result counts, the
same transaction behavior. Bakery's own ORM test suite passes on both sets of
drivers (see [Tests](#tests)).

The query builder is documented at
[bakery.okyle.dev](https://bakery.okyle.dev/?/orm/queries). Those pages say
`@bakery-framework/orm`; here the package is `bakery-orm`, and everything else
on them holds.

## Installing it

From an app beside this folder:

```json
{
  "dependencies": {
    "bakery-orm": "file:../bakery-orm",
    "postgres": "^3.4.9"
  }
}
```

`postgres` is needed only for a Postgres database on Node, and `mysql2` only
for MySQL on Node. SQLite needs nothing: it is `node:sqlite` on Node and
built into Bun.

Bun reads the TypeScript sources directly. Node runs the compiled `dist/`,
which is not checked in, so build it once and again after changing anything
under `src/`:

```bash
bun run build
```

## Connecting

```ts
import DB, { initDB } from 'bakery-orm'

await initDB()
const posts = await DB.from('posts').where('posts.published', 1).array()
```

`initDB()` opens the connection named by `DB_URL` once, and every query after
it uses that connection. Call it before the first query; a query before it
throws `DB not initialized`.

| `DB_URL` | Database |
| --- | --- |
| unset | SQLite, `bakery/server.db` under the working directory |
| `./data/app.db`, `sqlite:./data/app.db`, `:memory:` | SQLite |
| `postgres://user:pass@host:5432/name` | Postgres |
| `mysql://user:pass@host:3306/name?sslmode=require` | MySQL |

MySQL 8 needs `sslmode=require` (or `ssl=true`) on Bun, which refuses its
default password exchange over an unencrypted connection. mysql2 on Node
connects either way.

The pool size comes from the environment: `DB_POOL_MAX`,
`DB_POOL_IDLE_TIMEOUT`, `DB_POOL_CONNECTION_TIMEOUT` and
`DB_POOL_MAX_LIFETIME`, the timeouts in seconds. SQLite ignores all four.

`configure({ dataDir })` (or `BAKERY_ORM_DATA_DIR`) moves the default SQLite
file and its backups. `setLogCallback(fn)` receives every message the ORM
logs, for routing them into an app's own logger.

## Schema and sync

A schema is a set of `table()` declarations in `schema.ts` at the app's root,
or in an `orm/` folder ([how both layouts work](https://bakery.okyle.dev/?/orm/schema)):

```ts
import { Field, table } from 'bakery-orm'

export const users = table('users', {
  id: Field.Primary(),
  username: Field.Varchar(64),
  createdAt: Field.Date.now(),
})
```

Sync compares it with the database and migrates the difference, taking a
backup first. `--dry-run` prints the plan and changes nothing:

```bash
bun node_modules/bakery-orm/src/sync/index.ts --dry-run
```

On Node 24 the same command is
`node node_modules/bakery-orm/dist/sync/index.js`. Node strips the schema's
types rather than compiling it, which sets three limits that Bun does not
have:

- **The `table()` form only.** The older `export namespace DBInfo` form, which
  `--choose=db` writes into a single `schema.ts`, stops Node with
  `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.
- **Imports name their file.** In the `orm/` layout, `orm/index.ts` has to
  import `./tables.ts`, not `./tables`. The `orm/index.ts` that sync
  generates uses the short form, so on Node it needs that one edit. A schema
  that fails to load is read as no schema: sync warns `orm/index.ts could
  not be loaded` with the reason, and goes on as if the folder were empty.
- **A Node that can strip types.** Ubuntu's own `nodejs` 22 package is built
  without it and cannot load a `.ts` schema at all; the official builds can.

`--help` lists every flag. The ones used most: `--choose=db` writes the schema
from the database instead of the other way round, `--migrate` adopts a
database that sync did not create, and `--force-sync` skips the confirmation,
which `NODE_ENV=production` requires before any destructive change.

## Where it runs, and what was tested

| | SQLite | Postgres 16 | MySQL 8.4 |
| --- | --- | --- | --- |
| Bun 1.4.2, Bun's drivers | full suite | full suite | full suite |
| Bun 1.4.2, the Node drivers | full suite | full suite | full suite |
| Node 24.18 | scenario, sync | scenario | scenario |
| Node 22.22 | scenario | not run | not run |

"Full suite" is bakery's ORM tests plus this package's, 617 tests. "Scenario"
is `test/node/`, which runs an app's flow through the built package: insert,
select, update, delete, a transaction that commits, one that rolls back, a
nested one, and a statement racing a transaction. "Sync" is a schema created
from nothing, a second run that changes nothing, and an added column, in both
layouts. Postgres and MySQL were not reachable from the Node 22 install that
was available. A scan of the build for APIs newer than Node 22 found none in
their code path.

The SQLite driver relies on `StatementSync.columns()`, which Node 22.22 has
(earlier 22.x releases are untested), and refuses to start without it.

## How the Node drivers differ from Bun's

Every difference here was found by running the same statements through both.
The ones that mattered were closed; these are the ones left.

- **SQLite, one statement per call.** A string holding two statements is
  refused. `node:sqlite` would run the first and drop the rest silently, and
  Bun runs the rest of a DDL string but drops the rest of a DML one.
- **SQLite, big integers.** An INTEGER past 2^53 throws `ERR_OUT_OF_RANGE`
  when read. Bun returns it rounded to the nearest double.
- **SQLite, raw rows.** A row from a raw `query()` has a null prototype, as
  `node:sqlite` builds it. Rows from the query builder are plain objects on
  both runtimes.
- **SQLite, transactions.** A statement issued while another caller's
  transaction is open waits for it to finish. Bun's client runs it inside
  that transaction, so it rolls back with it.
- **Postgres, a bare parameter read back.** `SELECT $1` returns a number as
  text and a Date as a Date; Bun returns the number as a number and the Date
  as its `toString()`. Nothing the ORM generates selects a bare parameter.
- **MySQL, `sslmode=prefer`.** It is `require` on Node: mysql2 has no
  fallback to an unencrypted connection.
- **MySQL, `DB_POOL_MAX_LIFETIME`.** mysql2 has no such setting, so it does
  nothing on Node.

## Changes from bakery 2.0.4

Copied from bakery at `f809ece` (`packages/orm`, v2.0.4) with every import of
`@bakery-framework/core` replaced by `src/internal/`, which holds the parts of
core the ORM used. The adapters open their connection through `src/drivers/`,
and Bun's file and process calls became `node:fs` and `node:child_process`.
Four defects in bakery 2.0.4 are fixed here, each with a test that fails
without the fix:

- **`DB.isNull()` and `DB.isNotNull()` in an update or a delete** emitted
  `IS NULL NULL`, which no database parses. The select builder was right; the
  rule moved into the function all three share.
- **A SQLite backup in WAL mode** held nothing written since the last
  checkpoint: a table created and filled with 50 rows, then backed up, gave a
  file with no table in it. It copied the main file, and WAL keeps recent
  commits beside it. The backup is `VACUUM INTO` now. Sync takes one before
  every destructive migration.
- **A schema that failed to import** was read as no schema without a word,
  so sync reported success and wrote a boilerplate `schema.ts`. It still goes
  on that way, and now says which file failed and why.
- **A dry run left out the tables it would create.** On a fresh database
  with five tables and three indexes it listed the indexes only. The plan
  knew the tables all along; the printout, which a real run shows too, now
  has a `Tables to create` line.

All four are in bakery 2.1.0 as well (`92b6627`, `dfae849`, `9f84e85`,
`f385a7b`).

A fifth is fixed on Node only. On Bun, a SQLite statement issued while
another caller's transaction is open runs inside it and rolls back with it,
as in bakery; the Node driver makes it wait (see above).

## Tests

The suite needs `MYSQL_TEST_URL` and `PGSQL_TEST_URL` for the live database
tests, and reports them as skipped without:

```bash
bun run test
```

```bash
bun run test:node-drivers
```

```bash
bun run test:node
```

The first runs on Bun's drivers, the second on the Node drivers inside Bun,
and the third builds `dist/` and runs `test/node/` on whatever `node` is on
the path, which has to be a real Node.
