import DB from 'bakery-orm'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { AiError } from './ai/gemini.ts'
import { auth } from './routes/auth.ts'
import { bins } from './routes/bins.ts'
import { illustrations } from './routes/illustrations.ts'
import { respond } from './routes/public.ts'
import { notifications } from './routes/notifications.ts'
import { quizzes } from './routes/quizzes.ts'
import { responses } from './routes/responses.ts'
import { uploads } from './routes/uploads.ts'

export const app = new Hono().basePath('/api')

const tooLarge = (c: { json: (body: object, status: 413) => Response }) =>
  c.json({ error: 'That is too large to send. Use a smaller file or a shorter text.' }, 413)
const text = bodyLimit({ maxSize: 512 * 1024, onError: tooLarge })
const file = bodyLimit({ maxSize: 26 * 1024 * 1024, onError: tooLarge })
const TAKES_FILES = /^\/api\/(uploads|illustrations\/upload|quizzes\/\d+\/image)\/?$/
app.use('*', (c, next) => (TAKES_FILES.test(c.req.path) ? file : text)(c, next))

app.route('/auth', auth)
app.route('/quizzes', quizzes)
app.route('/bins', bins)
app.route('/notifications', notifications)
app.route('/responses', responses)
app.route('/uploads', uploads)
app.route('/illustrations', illustrations)
app.route('/', respond)

/** Answers with the runtime and whether the database is reachable and synced. */
app.get('/health', async (c) => {
  const quizzes = await DB.from('quizzes').select({ n: DB.count('*') }).value()
  return c.json({
    ok: true,
    runtime: 'Bun' in globalThis ? `bun ${Bun.version}` : `node ${process.version}`,
    quizzes: Number(quizzes),
  })
})

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
  if (err instanceof AiError) return c.json({ error: err.message }, err.status as 500)
  console.error(err)
  return c.json({ error: 'Something went wrong on the server. Try again.' }, 500)
})

app.notFound((c) => c.json({ error: `No route for ${c.req.method} ${c.req.path}` }, 404))
