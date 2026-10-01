# server

The API for the web app: Hono, with the database through `bakery-orm`
(`../bakery-orm`). Development runs on Bun; the deployed server runs on
Node.js 22.22 or later. Both run `src/index.ts` as it is: Node strips the
types itself, so there is no build step for this package.

## First run

```bash
cp .env.example .env
bun install
bun run db:sync
bun run dev
```

`http://localhost:3221/api/health` answers with the runtime and the number of
quizzes. The web app's dev server (`web/`, port 3220) forwards `/api` here.

## Scripts

| Script | What it does |
| --- | --- |
| `dev` | Bun, restarting on every change |
| `start` | Node, with `.env` loaded |
| `db:sync` | Migrates the database to `schema.ts`, with a backup first (Bun) |
| `db:sync:node` | The same on Node |
| `typecheck` | `tsc --noEmit` |

## The database

`schema.ts` declares the tables with `table()`, and indexes as exports beside
them. After a change to it, `bun run db:sync --dry-run` shows the plan and
`bun run db:sync` applies it. `DB_URL` in `.env` is a SQLite file by default
(`./data/silid.db`; backups go to `./data/backups`); a `postgres://` or
`mysql://` URL moves the same code to those.

Query reference: [bakery.okyle.dev](https://bakery.okyle.dev/?/orm/queries),
where `@bakery-framework/orm` reads as `bakery-orm`.

**After changing `../bakery-orm`:** Bun installs it as a copy, not a link.
Rebuild it (`bun run build` there, for Node's `dist/`), then run
`bun install` here, which copies it again.

## Node's limits on this code

Node runs TypeScript by stripping the types, so:

- relative imports name their file: `./app.ts`, not `./app`;
- no enums, namespaces or constructor parameter properties.
