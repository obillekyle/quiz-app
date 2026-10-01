import DB from 'bakery-orm'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { AiError } from './ai/gemini.ts'
import { auth } from './routes/auth.ts'
import { illustrations } from './routes/illustrations.ts'
import { respond } from './routes/public.ts'
import { notifications } from './routes/notifications.ts'
import { quizzes } from './routes/quizzes.ts'
import { responses } from './routes/responses.ts'
import { uploads } from './routes/uploads.ts'

export const app = new Hono().basePath('/api')

// A body is read whole before a route looks at it, and the deployed process
// has 450 MB: a few 100 MB posts to any route, signed in or not, would get it
// killed. Half a megabyte covers the largest JSON the app sends: the builder's
// Save measured 9,674 bytes for 11 questions, 879 a question, so the limit
// holds a quiz of about 600. The three routes that take a file
// get the largest file they accept (a 25 MB PDF) and its form's overhead.
const tooLarge = (c: { json: (body: object, status: 413) => Response }) =>
  c.json({ error: 'That is too large to send. Use a smaller file or a shorter text.' }, 413)
const text = bodyLimit({ maxSize: 512 * 1024, onError: tooLarge })
const file = bodyLimit({ maxSize: 26 * 1024 * 1024, onError: tooLarge })
const TAKES_FILES = /^\/api\/(uploads|illustrations\/upload|quizzes\/\d+\/image)\/?$/
app.use('*', (c, next) => (TAKES_FILES.test(c.req.path) ? file : text)(c, next))

app.route('/auth', auth)
app.route('/quizzes', quizzes)
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

// Every failure leaves as JSON with a message, never as an HTML error page,
// so the web app can always show what went wrong. A request error or an AI
// error carries a message written for people; anything else is a defect,
// logged here and described to the browser only in general terms.
app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
  if (err instanceof AiError) return c.json({ error: err.message }, err.status as 500)
  console.error(err)
  return c.json({ error: 'Something went wrong on the server. Try again.' }, 500)
})

app.notFound((c) => c.json({ error: `No route for ${c.req.method} ${c.req.path}` }, 404))
