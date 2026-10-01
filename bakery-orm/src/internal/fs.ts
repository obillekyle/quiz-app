/**
 * The four path helpers the ORM took from @bakery-framework/core's `fs`, over
 * `node:path` and `node:fs`, so they run on Node and on Bun alike. Paths come
 * back with forward slashes, as core's did.
 */
import { stat } from 'node:fs/promises'
import { dirname, parse, resolve } from 'node:path'

const slash = (p: string) => p.replace(/\\/g, '/')

export const fs = {
  resolve: (...parts: string[]) => slash(resolve(...parts)),
  dirname: (path: string) => slash(dirname(path)),
  parse: (path: string) => parse(path),
  async isDir(path: string): Promise<boolean> {
    // A path that cannot be statted is not a directory, which is the whole
    // question asked here; the caller then reports it as missing.
    return stat(path).then(
      s => s.isDirectory(),
      () => false,
    )
  },
}
