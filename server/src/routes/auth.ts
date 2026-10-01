import DB from 'bakery-orm'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { checkCode, codeMail, issueCode } from '../auth/codes.ts'
import { authorizeUrl, exchangeCode, googleConfigured, startRequest } from '../auth/google.ts'
import { DECOY_HASH, hashPassword, verifyPassword } from '../auth/password.ts'
import { COOKIE, currentUser, endSession, requireUser, startSession } from '../auth/session.ts'
import { addressOf, within } from '../limits.ts'
import { mailConfigured, mailToLog, sendMail, type Sent } from '../mail.ts'

export const auth = new Hono()

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const field = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

// A code per address has its own limits (auth/codes.ts). These bound one
// sender asking for codes to many addresses, which would spend the mailbox's
// daily sends, and password guesses, each of which costs a slow hash.
const codesFrom = new Map<string, number[]>()
const codesToday = new Map<string, number[]>()
const triesFrom = new Map<string, number[]>()
const triesFor = new Map<string, number[]>()
const busy = (message: string) => ({ error: message })

// ---- a code by email: one step that signs in an account or starts one ------------

/**
 * Emails a six-digit code. The same answer comes back whether or not the
 * address has an account, since the code itself is what proves the inbox.
 * `via` says whether it went by mail or, on a development server without
 * mail set up, only to the server's log.
 */
auth.post('/code', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const email = field(body.email).toLowerCase()
  if (!EMAIL.test(email) || email.length > 254)
    return c.json({ error: 'Enter a valid email address.', field: 'email' }, 400)
  if (!mailConfigured() && !mailToLog())
    return c.json({ error: 'Email sign-in is not set up on this server. Continue with Google instead.' }, 503)
  // Sixty, not ten: a hall's network is one sender, and the day's total below is what guards the mailbox.
  if (!within(codesFrom, addressOf(c), 60))
    return c.json(busy('Too many codes were asked for from here in the last hour. Try again later, or continue with Google.'), 429)
  if (!within(codesToday, 'all', 300, Date.now(), 24 * 3600_000))
    return c.json(busy('Too many codes were sent today. Continue with Google, or try again tomorrow.'), 429)

  const code = await issueCode(email)
  let via: Sent
  try {
    via = await sendMail({ to: email, ...codeMail(code) })
  } catch (e) {
    console.error('sign-in code mail:', e)
    return c.json({ error: 'The email did not go out. Try again in a minute, or continue with Google.' }, 502)
  }
  return c.json({ sent: true, via, wait: 30 })
})

/** Checks the code; a right one signs in, making the account first if the address is new. */
auth.post('/code/verify', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const email = field(body.email).toLowerCase()
  if (!EMAIL.test(email)) return c.json({ error: 'Enter a valid email address.', field: 'email' }, 400)
  await checkCode(email, typeof body.code === 'string' ? body.code : '')

  const existing = await DB.from('users').where('users.email', email).fetch()
  let user: { id: number; name: string; email: string }
  if (existing) user = { id: Number(existing.id), name: String(existing.name), email }
  else {
    // A name to stand in until the "tell us your name" step, or for good if it is skipped.
    const name = email.split('@')[0]!.slice(0, 80)
    const result = await DB.Insert.into('users').values({ name, email }).run()
    user = { id: Number(result.lastInsertRowid), name, email }
  }
  await startSession(c, user.id)
  return c.json({ user, isNew: !existing })
})

// ---- the account's settings ----------------------------------------------------

/** What the settings page shows: the ways in, and the devices signed in. */
auth.get('/account', requireUser, async (c) => {
  const user = c.get('user')
  const row: any = await DB.from('users').where('users.id', user.id).fetch()
  const now = Math.floor(Date.now() / 1000)
  const sessions = await DB.from('sessions').where('sessions.userId', user.id).and('sessions.expiresAt', DB.gt(now)).array()
  return c.json({
    name: String(row.name),
    email: String(row.email),
    password: !!row.passwordHash,
    google: !!row.googleId,
    devices: sessions.length,
  })
})

/** Sets a password, or changes one (which needs the current one). */
auth.post('/password', requireUser, async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const next = typeof body.next === 'string' ? body.next : ''
  const row: any = await DB.from('users').where('users.id', user.id).fetch()
  if (row.passwordHash) {
    const ok = await verifyPassword(typeof body.current === 'string' ? body.current : '', String(row.passwordHash))
    if (!ok) return c.json({ error: 'The current password is not right.', field: 'current' }, 400)
  }
  if (next.length < 8) return c.json({ error: 'Use at least 8 characters for the new password.', field: 'next' }, 400)
  await DB.Update.table('users').set({ passwordHash: await hashPassword(next) }).where('users.id', user.id).run()
  return c.json({ ok: true })
})

/** Signs out every other device; this one stays signed in. */
auth.post('/devices/sign-out', requireUser, async (c) => {
  const user = c.get('user')
  const mine = getCookie(c, COOKIE) ?? ''
  const all = await DB.from('sessions').where('sessions.userId', user.id).array()
  let ended = 0
  for (const s of all as any[]) {
    if (s.token === mine) continue
    await DB.Delete.from('sessions').where('sessions.id', s.id).run()
    ended++
  }
  return c.json({ ended })
})

/**
 * Deletes the account and everything in it: quizzes, their files, every
 * response, sessions. The email must be typed back, so it is not one click.
 */
auth.delete('/account', requireUser, async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  if (field(body.email).toLowerCase() !== user.email.toLowerCase())
    return c.json({ error: 'Type your email address exactly to delete the account.', field: 'email' }, 400)
  const files = await DB.from('sources').where('sources.userId', user.id).array()
  const quizzes = await DB.from('quizzes').where('quizzes.userId', user.id).array()
  const quizFiles = []
  for (const q of quizzes as any[]) quizFiles.push(...(await DB.from('sources').where('sources.quizId', q.id).array()))
  await DB.Delete.from('users').where('users.id', user.id).run()
  const { unlink } = await import('node:fs/promises')
  for (const f of [...files, ...quizFiles] as any[]) await unlink(String(f.path)).catch(() => {})
  deleteCookie(c, COOKIE, { path: '/' })
  return c.json({ ok: true })
})

/** The signed-in person's name, from the "tell us your name" step. */
auth.patch('/me', requireUser, async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const name = field(body.name)
  if (!name) return c.json({ error: 'Enter your name.', field: 'name' }, 400)
  if (name.length > 80) return c.json({ error: 'Use 80 characters or fewer for your name.', field: 'name' }, 400)
  const user = c.get('user')
  await DB.Update.table('users').set({ name }).where('users.id', user.id).run()
  return c.json({ user: { ...user, name } })
})

// There is no route that makes an account from a name, an email and a
// password alone. One existed, unused by the web app, and let anyone create
// an account for an address they do not own: its password kept working after
// the address's real owner later signed in by code or Google and landed in
// the same account. An account starts with a code sent to its inbox, or with
// Google; a password is added in Settings by someone already signed in.

auth.post('/login', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const email = field(body.email).toLowerCase()
  const password = typeof body.password === 'string' ? body.password : ''
  if (!within(triesFrom, addressOf(c), 30) || !within(triesFor, email, 10))
    return c.json(busy('Too many sign-in tries in the last hour. Try again later, or sign in with a code.'), 429)

  const user = email ? await DB.from('users').where('users.email', email).fetch() : null
  // An account made with Google has no password: it checks against the decoy
  // and fails like any wrong password.
  const ok = await verifyPassword(password, user?.passwordHash ? String(user.passwordHash) : DECOY_HASH)
  // One message for both cases, so the form does not tell a stranger which
  // emails have accounts.
  if (!user || !ok) return c.json({ error: 'The email or password is incorrect.' }, 401)

  await startSession(c, Number(user.id))
  return c.json({ user: { id: Number(user.id), name: String(user.name), email: String(user.email) } })
})

auth.post('/logout', async (c) => {
  await endSession(c)
  return c.json({ ok: true })
})

/** Who is signed in on this browser; `user` is null when nobody is. */
auth.get('/me', async (c) => c.json({ user: await currentUser(c) }))

// ---- Google -------------------------------------------------------------------

const PENDING = 'qa_google'

/** Where to land after signing in: a path of ours, or the app. */
// One slash, then only characters a path of this app uses: a backslash or a
// tab after the slash ("/\\evil.com") is read by browsers as "//evil.com".
const safeNext = (n: string | undefined) => (n && /^\/(?![/\\])[\w\-./?=&%~+:@,;]*$/.test(n) ? n : '/app')

/** Sends the browser to Google's account chooser. */
auth.get('/google', (c) => {
  if (!googleConfigured()) return c.redirect('/login?error=google-off')
  const { state, verifier, challenge } = startRequest()
  // What the callback needs to finish this sign-in, for ten minutes and for
  // this browser only. SameSite=Lax still sends it on Google's redirect back,
  // which is a top-level navigation.
  setCookie(c, PENDING, JSON.stringify({ state, verifier, next: safeNext(c.req.query('next')) }), {
    httpOnly: true,
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/auth/google',
    maxAge: 600,
  })
  return c.redirect(authorizeUrl(c, state, challenge))
})

/**
 * Google sends the browser back here. Every failure goes to the sign-in page
 * with a reason the page knows how to word; details go to the server log.
 */
auth.get('/google/callback', async (c) => {
  let pending: { state: string; verifier: string; next: string } | null = null
  try {
    pending = JSON.parse(getCookie(c, PENDING) ?? '')
  } catch {}
  deleteCookie(c, PENDING, { path: '/api/auth/google' })

  const fail = (reason: string, detail?: unknown) => {
    if (detail) console.error('google sign-in:', detail)
    return c.redirect(`/login?error=${reason}`)
  }

  // `error` is set when the person closed the chooser (access_denied).
  if (c.req.query('error')) return fail('google-cancelled')
  const code = c.req.query('code')
  if (!pending || !code || c.req.query('state') !== pending.state) return fail('google-expired')

  let profile
  try {
    profile = await exchangeCode(c, code, pending.verifier)
  } catch (e) {
    return fail('google-failed', e)
  }
  if (!profile.email || !profile.emailVerified) return fail('google-unverified')

  // One person, three ways in: already linked; an email account with the same
  // verified address (linked now, so both ways reach one account); or new.
  let user = await DB.from('users').where('users.googleId', profile.sub).fetch()
  if (!user) {
    user = await DB.from('users').where('users.email', profile.email).fetch()
    if (user) await DB.Update.table('users').set({ googleId: profile.sub }).where('users.id', user.id).run()
  }
  let id: number
  if (user) id = Number(user.id)
  else {
    const result = await DB.Insert.into('users')
      .values({ name: profile.name || profile.email.split('@')[0], email: profile.email, googleId: profile.sub })
      .run()
    id = Number(result.lastInsertRowid)
  }

  await startSession(c, id)
  return c.redirect(pending.next)
})
