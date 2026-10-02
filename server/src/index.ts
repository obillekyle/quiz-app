import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { initDB } from 'bakery-orm'
import { Hono } from 'hono'
import { app } from './app.ts'

const port = Number(process.env.PORT ?? 3221)

await initDB()

const staticDir = resolve(process.env.STATIC_DIR ?? '../web/dist')
const root = new Hono()
root.route('/', app)
if (existsSync(resolve(staticDir, 'index.html'))) {
  // Hashed assets never change under their name; index.html must be fetched fresh.
  const cache = (path: string) =>
    path.replace(/\\/g, '/').includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
  const { serveStatic } = 'Bun' in globalThis ? await import('hono/bun') : await import('@hono/node-server/serve-static')
  // The pages' fallback would answer an unknown API path with index.html and 200.
  root.all('/api/*', (c) => c.json({ error: `No route for ${c.req.method} ${c.req.path}` }, 404))
  root.use('/*', serveStatic({ root: staticDir, onFound: (path, c) => c.header('cache-control', cache(path)) }))
  root.get('/*', serveStatic({ root: staticDir, path: 'index.html' }))
  console.log(`serving pages from ${staticDir}`)
}

if ('Bun' in globalThis) {
  Bun.serve({ port, fetch: root.fetch, idleTimeout: 255 })
} else {
  const { serve } = await import('@hono/node-server')
  serve({ port, fetch: root.fetch })
}

console.log(`silid server on http://localhost:${port}/api`)
