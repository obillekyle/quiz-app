import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requireUser, type User } from '../auth/session.ts'
import { within } from '../limits.ts'
import { attach, find, fromUpload, readIllustration, type Asked } from '../quiz/illustrate.ts'
import { loadSources } from '../quiz/sources.ts'
import { ownQuiz } from '../quiz/store.ts'

/**
 * Pictures for questions. The builder asks for candidates, attaches one (or
 * uploads its own), and saves the returned `image`, `imageAlt` and
 * `imageCredit` with the question as it saves any other field. The files are
 * served to anyone, since a shared quiz shows them to people with no
 * account; each name is 96 random bits, so a draft's pictures cannot be
 * guessed.
 */
export const illustrations = new Hono<{ Variables: { user: User } }>()

illustrations.get('/file/:name', async (c) => {
  const file = await readIllustration(c.req.param('name'))
  if (!file) throw new HTTPException(404, { message: 'There is no such picture.' })
  return c.body(file.bytes, 200, {
    'content-type': file.type,
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  })
})

/** Candidates for one question: crops from its page of the module, then Commons pictures. */
const finds = new Map<string, number[]>()

illustrations.post('/find', requireUser, async (c) => {
  if (!within(finds, `u${c.get('user').id}`, 60))
    throw new HTTPException(429, { message: 'Too many picture searches in the last hour. Try again later.' })
  const body = await c.req.json().catch(() => ({}))
  const quiz = await ownQuiz(Number(body.quizId), c.get('user').id)
  const q = body.question ?? {}
  const prompt = typeof q.prompt === 'string' ? q.prompt.trim().slice(0, 2000) : ''
  if (!prompt) throw new HTTPException(400, { message: 'Write the question first, then find a picture for it.' })
  const asked: Asked = {
    prompt,
    topic: typeof q.topic === 'string' ? q.topic.slice(0, 120) : null,
    quote: typeof q.quote === 'string' ? q.quote.slice(0, 1000) : null,
    file: typeof q.file === 'string' ? q.file : null,
    page: Number.isInteger(q.page) ? q.page : null,
  }
  return c.json(await find(asked, await loadSources(Number(quiz.id))))
})

/** Makes a candidate the question's picture; the builder then saves it with the question. */
illustrations.post('/attach', requireUser, async (c) => {
  const body = await c.req.json().catch(() => ({}))
  await ownQuiz(Number(body.quizId), c.get('user').id)
  return c.json(await attach(body.candidate ?? {}))
})

/** The teacher's own picture. */
illustrations.post('/upload', requireUser, async (c) => {
  const body = await c.req.parseBody().catch(() => {
    throw new HTTPException(400, { message: 'The picture could not be read. Try again.' })
  })
  await ownQuiz(Number(body.quizId), c.get('user').id)
  const file = body.file
  if (!(file instanceof File)) throw new HTTPException(400, { message: 'Choose a JPG, PNG or WebP picture.' })
  return c.json(await fromUpload(file))
})
