import DB from 'bakery-orm'
import { Hono } from 'hono'
import { requireUser, type User } from '../auth/session.ts'

/**
 * Every response to the user's quizzes, for the sidebar's Responses page:
 * people still answering first, then the finished ones, newest first.
 */
export const responses = new Hono<{ Variables: { user: User } }>()

responses.use('*', requireUser)

responses.get('/', async (c) => {
  const user = c.get('user')
  const quizzes = await DB.from('quizzes').where('quizzes.userId', user.id).array()
  const out: {
    id: number
    quizId: number
    quiz: string
    name: string
    section: string | null
    status: 'open' | 'finished'
    score: number
    total: number
    finishedAt: number | null
  }[] = []
  for (const q of quizzes as any[]) {
    const rows = await DB.from('responses').where('responses.quizId', q.id).orderBy('responses.id', 'DESC').limit(200).array()
    for (const r of rows as any[])
      out.push({
        id: Number(r.id),
        quizId: Number(q.id),
        quiz: String(q.title),
        name: String(r.name),
        section: r.section ? String(r.section) : null,
        status: r.status === 'finished' ? 'finished' : 'open',
        score: Number(r.score),
        total: Number(r.total),
        finishedAt: r.finishedAt == null ? null : Number(r.finishedAt),
      })
  }
  out.sort((a, b) => (b.finishedAt ?? Number.MAX_SAFE_INTEGER) - (a.finishedAt ?? Number.MAX_SAFE_INTEGER) || b.id - a.id)
  return c.json({ responses: out.slice(0, 300), quizzes: new Set(out.map((r) => r.quizId)).size })
})

/**
 * Finished responses per day for each of the user's quizzes, for the
 * sparklines on the home list: `days` counts per quiz, oldest first, the last
 * one today. Days are the browser's (`tz` is its getTimezoneOffset(), in
 * minutes), so "today" ends at the user's midnight, not the server's.
 */
responses.get('/activity', async (c) => {
  const user = c.get('user')
  const days = Math.min(90, Math.max(7, Number(c.req.query('days')) || 30))
  const tz = Math.max(-840, Math.min(840, Number(c.req.query('tz')) || 0))
  const shift = -tz * 60
  const today = Math.floor((Date.now() / 1000 + shift) / 86400)
  const since = (today - days + 1) * 86400 - shift
  const quizzes = (await DB.from('quizzes').where('quizzes.userId', user.id).array()) as any[]
  const out: Record<number, number[]> = {}
  for (const q of quizzes) {
    const counts = Array.from({ length: days }, () => 0)
    const rows = (await DB.from('responses')
      .where('responses.quizId', q.id)
      .and('responses.status', 'finished')
      .and('responses.finishedAt', DB.gt(since - 1))
      .array()) as any[]
    for (const r of rows) {
      const i = Math.floor((Number(r.finishedAt) + shift) / 86400) - (today - days + 1)
      if (i >= 0 && i < days) counts[i]!++
    }
    out[Number(q.id)] = counts
  }
  return c.json({ days, quizzes: out })
})
