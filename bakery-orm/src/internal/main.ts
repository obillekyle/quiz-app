import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * `import.meta.main`, for the three CLI entries under `sync/`.
 *
 * Bun and Node 24 set it. Node 22 does not, and an entry guarded by it alone
 * did nothing there, without a word. The fallback compares the script Node
 * was started with against this module, both through `realpath`, since a
 * package linked into `node_modules` is started by one path and loaded by
 * another.
 */
export function isMain(meta: ImportMeta): boolean {
  const flag = (meta as { main?: unknown }).main
  if (typeof flag === 'boolean') return flag
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(resolve(entry)) === realpathSync(fileURLToPath(meta.url))
  } catch {
    // A path that cannot be resolved is not this module.
    return false
  }
}
