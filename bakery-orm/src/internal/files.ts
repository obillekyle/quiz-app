/**
 * The three `Bun.file` calls schema sync made, over `node:fs`, so the same
 * code runs on Node and on Bun.
 *
 * Each keeps the semantics of the call it replaced: `exists` is true for a
 * file and false for a directory (Bun's `exists()` answers false for one,
 * checked), and `write` creates the parent directories, which `Bun.write`
 * does on its own.
 */
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const files = {
  async exists(path: string): Promise<boolean> {
    // Anything stat refuses (missing, unreadable) is "no file here", which is
    // the only question asked.
    return stat(path).then(
      s => s.isFile(),
      () => false,
    )
  },
  async text(path: string): Promise<string> {
    return await readFile(path, 'utf8')
  },
  async write(path: string, contents: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, contents)
  },
  async remove(path: string): Promise<void> {
    await unlink(path)
  },
}
