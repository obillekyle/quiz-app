import DB from 'bakery-orm'
import { Hono } from 'hono'
import { requireUser, type User } from '../auth/session.ts'

export const notifications = new Hono<{ Variables: { user: User } }>()

notifications.use('*', requireUser)

const REASON: Record<string, string> = {
  wrong: 'An answer is wrong',
  harmful: 'Harmful or unsafe content',
  copied: 'Copies someone else\u2019s work',
  other: 'Something else',
}

type Item = { id: string; kind: 'response' | 'report'; quiz: string; title: string; detail: string | null; at: number; to: string }

notifications.get('/', async (c) => {
  const user = c.get('user')
  const me: any = await DB.from('users').where('users.id', user.id).fetch()
  const seen = me?.noticesSeenAt == null ? 0 : Number(me.noticesSeenAt)
  const quizzes = await DB.from('quizzes').where('quizzes.userId', user.id).array()
  const items: Item[] = []
  for (const q of quizzes as any[]) {
    const quizId = Number(q.id)
    const title = String(q.title)
    const done = await DB.from('responses')
      .where('responses.quizId', quizId)
      .and('responses.status', 'finished')
      .orderBy('responses.finishedAt', 'DESC')
      .limit(10)
      .array()
    for (const r of done as any[]) {
      if (r.finishedAt == null) continue
      items.push({
        id: `r${r.id}`,
        kind: 'response',
        quiz: title,
        title: `${r.name} finished`,
        detail: `${Number(r.score)} / ${Number(r.total)}`,
        at: Number(r.finishedAt),
        to: `/app/quiz/${quizId}/responses/${r.id}`,
      })
    }
    const reports = await DB.from('reports').where('reports.quizId', quizId).orderBy('reports.id', 'DESC').limit(10).array()
    for (const r of reports as any[]) {
      items.push({
        id: `p${r.id}`,
        kind: 'report',
        quiz: title,
        title: `Report: ${REASON[r.reason] ?? 'Something else'}`,
        detail: r.note ?? null,
        at: Number(r.createdAt),
        to: `/app/quiz/${quizId}#reports`,
      })
    }
  }
  items.sort((a, b) => b.at - a.at)
  const list = items.slice(0, 25)
  return c.json({ items: list.map((i) => ({ ...i, unread: i.at > seen })), unread: list.filter((i) => i.at > seen).length })
})

/** The bell was opened: everything up to now is read. */
notifications.post('/seen', async (c) => {
  await DB.Update.table('users').set({ noticesSeenAt: Math.floor(Date.now() / 1000) }).where('users.id', c.get('user').id).run()
  return c.json({ ok: true })
})
