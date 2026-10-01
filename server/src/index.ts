import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { initDB } from 'bakery-orm'
import { Hono } from 'hono'
import { app } from './app.ts'

const port = Number(process.env.PORT ?? 3221)

await initDB()

/*
 * Deployed, the one process answers everything: `/api` from the app, and the
 * built pages from web/dist (STATIC_DIR to put them elsewhere), any address
 * that is no file answered with index.html so the router can take it. The
 * hosting box maps a domain to one target, a folder or a port, so the pages
 * ride with the API. In development Vite serves the pages and nothing is
 * built, so this stays off.
 */
const staticDir = resolve(process.env.STATIC_DIR ?? '../web/dist')
const root = new Hono()
root.route('/', app)
if (existsSync(resolve(staticDir, 'index.html'))) {
  // Hashed assets never change under their name; index.html must be fetched fresh.
  const cache = (path: string) =>
    path.replace(/\\/g, '/').includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
  // `path` is joined onto `root`: an absolute path there became a relative
  // one on Linux ("home/okyle/...") and every deep link answered 404.
  const { serveStatic } = 'Bun' in globalThis ? await import('hono/bun') : await import('@hono/node-server/serve-static')
  // The pages' fallback would answer an unknown API path with index.html and 200.
  root.all('/api/*', (c) => c.json({ error: `No route for ${c.req.method} ${c.req.path}` }, 404))
  root.use('/*', serveStatic({ root: staticDir, onFound: (path, c) => c.header('cache-control', cache(path)) }))
  root.get('/*', serveStatic({ root: staticDir, path: 'index.html' }))
  console.log(`serving pages from ${staticDir}`)
}

// The same app on both runtimes: Bun serves a fetch handler natively, Node
// through Hono's adapter.
if ('Bun' in globalThis) {
  // Bun closes a connection that sends nothing for 10 s by default, and an AI
  // draft takes 15 to 25 s; 255 s is Bun's maximum. Node's default is 300 s.
  Bun.serve({ port, fetch: root.fetch, idleTimeout: 255 })
} else {
  const { serve } = await import('@hono/node-server')
  serve({ port, fetch: root.fetch })
}

console.log(`silid server on http://localhost:${port}/api`)
