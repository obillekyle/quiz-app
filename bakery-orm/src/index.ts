import { DB, Mutation } from './orm/index.js'

export default DB
export type {
  QueryEvent,
  QueryMethod,
  QueryObserver,
  QueryObserverOptions,
} from './adapters/observe.js'
/**
 * Query observability.
 *
 * Re-exported from the root rather than given a `./observe` subpath. The
 * export map is closed and every entry in it is public API from the moment it
 * ships, so a new subpath needs a reason, and there is none here: this is one
 * function and three types, the observer is process-wide, and an app sets it
 * once at boot next to where it already imports `DB`.
 *
 * `./adapters` *is* public now, but for writing an adapter, not for reaching
 * these: an app that only wants an observer should not have to import the
 * module that can open a database connection.
 */
export { getQueryObserver, setQueryObserver } from './adapters/observe.js'
export type {
  InferOptionals,
  InferSchema,
  InferViews,
  InsertOf,
  RowOf,
  TableColumn,
  TableRef,
} from './define.js'
/**
 * Schema authoring, from one place.
 *
 * `table`/`alias` live in `define.ts` and the column and constraint helpers in
 * `schema-util.ts`, but that split is an implementation detail: someone
 * writing `orm/schema.ts` should import from `bakery-orm` without having to
 * know which file a helper happens to sit in.
 */
export { alias, table, view } from './define.js'
export { Field } from './field.js'
/**
 * `TableDef` is the **column** descriptor (`TableDef<TYPE, nullable, optional>`
 *), and it now comes from the root barrel, which is where someone writing a
 * schema would look for it.
 *
 * It did not, and that was a defect rather than an omission: the barrel used to
 * export `define.ts`'s same-named type, which describes a *table*. Two public
 * types under one name, and nothing errors at the import site.
 */
export type {
  ExtractOptionals,
  ExtractTableTypes,
  ExtractViews,
  TableDef,
} from './schema-util.js'
export {
  col,
  dateNow,
  old,
} from './schema-util.js'
export { DB, Mutation }

/**
 * Opening the connection, and where the data lives. Inside bakery the
 * framework did both at boot; on its own, an app calls `configure()` (if the
 * defaults do not suit) and `initDB()` once, before its first query.
 * `bakery-orm/connection` has the rest: `connection`, `getActiveDb()`.
 */
export { closeDB, initDB } from './connection.js'
export { configure, type OrmSettings, setLogCallback } from './internal/index.js'
