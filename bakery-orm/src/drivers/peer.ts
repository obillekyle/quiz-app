import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/**
 * Loads an optional peer driver, synchronously, because the adapters open
 * their connection in a constructor.
 *
 * Absence and breakage are kept apart: only "this package is not installed"
 * becomes the install hint. A driver that is installed and throws while
 * loading is a real fault, and it propagates as itself.
 */
export function peer<T>(name: string, forWhat: string): T {
  try {
    return require(name) as T
  } catch (error) {
    const code = (error as { code?: unknown })?.code
    const missing =
      (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') &&
      String((error as Error).message).includes(name)
    if (!missing) throw error
    // `mysql2/promise` is loaded, `mysql2` is what gets installed.
    const pkg = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]
    throw new Error(
      `${forWhat} on Node needs the '${pkg}' package, and it is not installed. ` +
        `Add it to the app's dependencies: bun add ${pkg}`,
      { cause: error },
    )
  }
}
