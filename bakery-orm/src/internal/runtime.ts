/**
 * What @bakery-framework/core's `Bakery` object gave the ORM, without the
 * framework: where its data lives, and the two settings it read from
 * bakery's `server.config.ts`.
 *
 * - `dataDir`: the default SQLite file is `<dataDir>/server.db`, and backups
 *   land beside it. Defaults to `./bakery` under the working directory, as in
 *   bakery; `BAKERY_ORM_DATA_DIR` moves it.
 * - `schema`: where schema sync finds the app's tables. Unset, sync looks for
 *   `orm/index.ts`, then `schema.ts`. `BAKERY_ORM_SCHEMA` sets it.
 * - `backups`: options for `backup()`.
 *
 * `configure()` changes any of them; call it before the first query.
 */
import { resolve } from 'node:path'

export interface OrmSettings {
  dataDir: string
  /** Scratch space that can be deleted at any time. Only the tests write here. */
  cacheDir: string
  schema?: string
  backups?: unknown
}

export const settings: OrmSettings = {
  dataDir: resolve(process.env.BAKERY_ORM_DATA_DIR || resolve(process.cwd(), 'bakery')),
  cacheDir: resolve(process.cwd(), '.cache'),
  schema: process.env.BAKERY_ORM_SCHEMA || undefined,
  backups: undefined,
}

export function configure(next: Partial<OrmSettings>): void {
  Object.assign(settings, next)
}

/** The shape the copied ORM code reads, so it needed no edits. */
export const Bakery = {
  get dataDir(): string {
    return settings.dataDir.replace(/\\/g, '/')
  },
  get cacheDir(): string {
    return settings.cacheDir.replace(/\\/g, '/')
  },
  get config(): { schema?: string; backups?: any } {
    return { schema: settings.schema, backups: settings.backups as any }
  },
}

/** Stands in for core's `initConfig()`, which sync calls to read `schema`. */
export async function initConfig() {
  return Bakery.config
}
