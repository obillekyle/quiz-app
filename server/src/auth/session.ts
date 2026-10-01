import { randomBytes } from 'node:crypto'
import DB from 'bakery-orm'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'

export const COOKIE = 'qa_session'
const DAYS = 30

export type User = { id: number; name: string; email: string }

const now = () => Math.floor(Date.now() / 1000)

/** Signs the user in on this browser: a new session row and its cookie. */
export async function startSession(c: Context, userId: number) {
  const token = randomBytes(32).toString('hex')
  await DB.Insert.into('sessions')
    .values({ token, userId, expiresAt: now() + DAYS * 86400 })
    .run()
  // httpOnly: page scripts cannot read it, so a script injected into the page
  // cannot steal the session. SameSite=Lax: other sites cannot send it along
  // with a form post. Secure in production, where the site is HTTPS.
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: DAYS * 86400,
  })
}

export async function endSession(c: Context) {
  const token = getCookie(c, COOKIE)
  if (token) await DB.Delete.from('sessions').where('sessions.token', token).run()
  deleteCookie(c, COOKIE, { path: '/' })
}

/** The signed-in user, or null. An expired session is deleted on sight. */
export async function currentUser(c: Context): Promise<User | null> {
  const token = getCookie(c, COOKIE)
  if (!token) return null
  const session = await DB.from('sessions').where('sessions.token', token).fetch()
  if (!session) return null
  if (Number(session.expiresAt) <= now()) {
    await DB.Delete.from('sessions').where('sessions.id', session.id).run()
    return null
  }
  const user = await DB.from('users').where('users.id', session.userId).fetch()
  return user ? { id: Number(user.id), name: String(user.name), email: String(user.email) } : null
}

/**
 * Route guard: answers 401 for nobody, otherwise puts the user on the
 * context for the handler (`c.get('user')`).
 */
export const requireUser = createMiddleware<{ Variables: { user: User } }>(async (c, next) => {
  const user = await currentUser(c)
  if (!user) return c.json({ error: 'Sign in to continue.' }, 401)
  c.set('user', user)
  await next()
})
