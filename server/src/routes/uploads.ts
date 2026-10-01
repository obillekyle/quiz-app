import { unlink } from 'node:fs/promises'
import DB from 'bakery-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requireUser, type User } from '../auth/session.ts'
import { isReading, startReading } from '../quiz/read.ts'
import { ownUpload, saveUpload, toSource, type Source } from '../quiz/sources.ts'

/**
 * Files from the prompt box, uploaded the moment they are picked and read at
 * once, so the material is ready (or nearly) by the time the prompt is sent.
 * Sending the prompt attaches them to the quiz by id (`POST /quizzes`,
 * `POST /quizzes/:id/chat`).
 */
export const uploads = new Hono<{ Variables: { user: User } }>()

uploads.use('*', requireUser)

/** What the prompt box shows for a file: no path, no text. */
const view = (s: Source) => ({
  id: s.id,
  name: s.name,
  size: s.size,
  status: s.status,
  method: s.method,
  pages: s.pages?.length ?? null,
  error: s.error,
})

uploads.post('/', async (c) => {
  const body = await c.req.parseBody().catch(() => {
    throw new HTTPException(400, { message: 'The upload could not be read. Try again.' })
  })
  const file = body.file
  if (!(file instanceof File)) throw new HTTPException(400, { message: 'Attach a PDF or a photo.' })
  const source = await saveUpload(c.get('user').id, file)
  startReading(source.id)
  return c.json(view(source), 201)
})

/** Where the reading stands. A read cut short by a restart starts again here. */
uploads.get('/:id', async (c) => {
  const row = await ownUpload(Number(c.req.param('id')), c.get('user').id)
  if (row.status === 'reading' && !isReading(Number(row.id))) startReading(Number(row.id))
  return c.json(view(toSource(row)))
})

/** Takes a file back out of the prompt box, before it is sent. */
uploads.delete('/:id', async (c) => {
  const row = await ownUpload(Number(c.req.param('id')), c.get('user').id)
  if (row.quizId != null) throw new HTTPException(409, { message: 'This file is already part of a quiz.' })
  await DB.Delete.from('sources').where('sources.id', row.id).run()
  await unlink(String(row.path)).catch(() => {})
  return c.json({ ok: true })
})
