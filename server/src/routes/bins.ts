import DB from 'bakery-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requireUser, type User } from '../auth/session.ts'

export const bins = new Hono<{ Variables: { user: User } }>()

bins.use('*', requireUser)

const bad = (message: string) => new HTTPException(400, { message })

/** The name from a JSON body: trimmed, 1 to 80 characters (the column's width). */
async function nameFrom(c: { req: { json: () => Promise<any> } }) {
  const body = await c.req.json().catch(() => ({}))
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) throw bad('Give the bin a name.')
  if (name.length > 80) throw bad('Use a name of 80 characters or fewer.')
  return name
}

/** The bin if it is this user's; a 404 otherwise, so ids reveal nothing. */
async function ownBin(id: number, userId: number) {
  const bin = Number.isInteger(id) ? await DB.from('bins').where('bins.id', id).and('bins.owner', userId).fetch() : null
  if (!bin) throw new HTTPException(404, { message: 'This bin does not exist.' })
  return bin
}

/** The user's bins by name, each with the count of its quizzes outside the archive. */
bins.get('/', async (c) => {
  const user = c.get('user')
  const rows = await DB.from('bins').where('bins.owner', user.id).array()
  const quizzes = await DB.from('quizzes').where('quizzes.userId', user.id).array()
  const count = new Map<number, number>()
  for (const q of quizzes as any[]) {
    if (q.bin == null || Number(q.archived)) continue
    count.set(Number(q.bin), (count.get(Number(q.bin)) ?? 0) + 1)
  }
  return c.json(
    (rows as any[])
      .map((b) => ({ id: Number(b.id), name: String(b.name), count: count.get(Number(b.id)) ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )
})

bins.post('/', async (c) => {
  const name = await nameFrom(c)
  const r = await DB.Insert.into('bins').values({ name, owner: c.get('user').id }).run()
  return c.json({ id: Number(r.lastInsertRowid), name, count: 0 }, 201)
})

bins.patch('/:id', async (c) => {
  const bin = await ownBin(Number(c.req.param('id')), c.get('user').id)
  const name = await nameFrom(c)
  await DB.Update.table('bins')
    .set({ name, updatedAt: Math.floor(Date.now() / 1000) })
    .where('bins.id', bin.id)
    .run()
  return c.json({ id: Number(bin.id), name })
})

/** Deletes the bin. Its quizzes stay: the foreign key on `quizzes.bin` sets them back to no bin. */
bins.delete('/:id', async (c) => {
  const bin = await ownBin(Number(c.req.param('id')), c.get('user').id)
  await DB.Delete.from('bins').where('bins.id', bin.id).run()
  return c.json({ ok: true })
})
