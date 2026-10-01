import { randomBytes } from 'node:crypto'
import { cp, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import DB from 'bakery-orm'
import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { draftQuiz, refineQuiz, applyOps, teachAgainNote } from '../ai/quiz.ts'
import { requireUser, type User } from '../auth/session.ts'
import { resultsMail, sendMail } from '../mail.ts'
import { whenRead } from '../quiz/read.ts'
import { attachSources, loadSources, materialParts, removeFiles, type Source } from '../quiz/sources.ts'
import { addMessage, clean, exclusive, fullQuiz, newShareCode, ownQuiz, saveQuestions, settingsOf, type Saving } from '../quiz/store.ts'

export const quizzes = new Hono<{ Variables: { user: User } }>()

const bad = (message: string) => new HTTPException(400, { message })
const now = () => Math.floor(Date.now() / 1000)

// ---- the cover image --------------------------------------------------------------

const UPLOADS = join(process.cwd(), 'data', 'uploads')
const COVER_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }
const COVER_MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }
const COVER_NAME = /^cover-\d+-[0-9a-f]{12}\.(jpg|png|webp|gif)$/
/** The page shrinks a photo to 1600 px of WebP before sending it; this is the ceiling for anything else. */
const MAX_COVER = 5 * 1024 * 1024

/** The first bytes of each allowed type, so a file is what it says it is. */
function sniff(bytes: Uint8Array): string | null {
  const at = (i: number, s: string) => [...s].every((ch, k) => bytes[i + k] === ch.charCodeAt(0))
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (bytes[0] === 0x89 && at(1, 'PNG')) return 'png'
  if (at(0, 'GIF8')) return 'gif'
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'webp'
  return null
}

/**
 * A quiz's cover, by the address `coverUrl` gives. It answers before the
 * sign-in guard below: the file's name is random and changes with every
 * upload, so the address itself is the permission, as a share code is, and
 * the shared quiz's page can show the cover to respondents with no account.
 */
quizzes.get('/:id/image/:file', async (c) => {
  const file = c.req.param('file')
  const id = Number(c.req.param('id'))
  const q = COVER_NAME.test(file) && Number.isInteger(id) ? await DB.from('quizzes').where('quizzes.id', id).fetch() : null
  if (!q || typeof q.image !== 'string' || basename(q.image) !== file) throw new HTTPException(404, { message: 'This image does not exist.' })
  const bytes = await readFile(join(UPLOADS, q.image)).catch(() => null)
  if (!bytes) throw new HTTPException(404, { message: 'This image does not exist.' })
  return c.body(new Uint8Array(bytes), 200, {
    'content-type': COVER_MIME[file.split('.').pop()!]!,
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  })
})

quizzes.use('*', requireUser)

/** A JSON body's text field and its source ids (files the prompt box already uploaded). */
async function message(c: { req: { json: () => Promise<any> } }, field: string) {
  const body = await c.req.json().catch(() => ({}))
  const text = typeof body?.[field] === 'string' ? body[field].trim() : ''
  const ids: number[] = Array.isArray(body?.sources) ? body.sources.map(Number).filter(Number.isInteger) : []
  return { text, ids }
}

/**
 * The quiz's material, once every file of it has been read: reads still
 * running (a file sent seconds after it was picked) are waited for here.
 */
async function material(quizId: number) {
  const pending = (await loadSources(quizId)).filter((s) => s.status === 'reading')
  if (pending.length) await whenRead(pending.map((s) => s.id))
  const sources = await loadSources(quizId)
  return { sources, parts: await materialParts(sources) }
}

const names = (sources: Source[]) => sources.map((s) => s.name)

/** The signed-in user's quizzes, newest edit first, each with its question count and its finished responses. */
quizzes.get('/', async (c) => {
  const user = c.get('user')
  const rows = await DB.from('quizzes').where('quizzes.userId', user.id).orderBy('quizzes.updatedAt', 'DESC').array()
  const counts = await DB.from('questions')
    .select({ quizId: 'questions.quizId', n: DB.count('*') })
    .groupBy('questions.quizId')
    .array()
  const byQuiz = new Map(counts.map((r: any) => [Number(r.quizId), Number(r.n)]))
  const done = await DB.from('responses')
    .select({ quizId: 'responses.quizId', n: DB.count('*') })
    .where('responses.status', 'finished')
    .groupBy('responses.quizId')
    .array()
  const finishedBy = new Map(done.map((r: any) => [Number(r.quizId), Number(r.n)]))
  return c.json({
    quizzes: rows.map((q: any) => ({
      id: Number(q.id),
      title: String(q.title),
      language: q.language,
      status: q.status,
      archived: !!Number(q.archived),
      shareCode: q.shareCode,
      questions: byQuiz.get(Number(q.id)) ?? 0,
      responses: finishedBy.get(Number(q.id)) ?? 0,
      createdAt: Number(q.createdAt),
      updatedAt: Number(q.updatedAt),
      ...settingsOf(q),
    })),
  })
})

/**
 * Starts a quiz from the home prompt box: the request is saved, the files it
 * already uploaded join the quiz, and the quiz's id comes back at once, so
 * the builder can open and show the AI working (`POST /:id/draft`) instead of
 * a spinner on the home page.
 */
quizzes.post('/', async (c) => {
  const user = c.get('user')
  const { text, ids } = await message(c, 'prompt')
  if (!text && !ids.length) throw new HTTPException(400, { message: 'Describe the quiz, or attach a module or photos.' })

  const r = await DB.Insert.into('quizzes')
    .values({ userId: user.id, title: 'Untitled quiz', shareCode: await newShareCode(), prompt: text || null })
    .run()
  const id = Number(r.lastInsertRowid)
  const attached = await attachSources(id, user.id, ids)
  await addMessage(id, 'user', text || 'Make a quiz from this material.', attached.length ? { files: names(attached) } : null)
  return c.json({ id }, 201)
})

quizzes.get('/:id', async (c) => {
  const quiz = await ownQuiz(Number(c.req.param('id')), c.get('user').id)
  return c.json(await fullQuiz(Number(quiz.id)))
})

/** The AI's first draft, from the request and files saved by `POST /`. */
quizzes.post('/:id/draft', async (c) => {
  const quiz = await ownQuiz(Number(c.req.param('id')), c.get('user').id)
  const id = Number(quiz.id)
  return exclusive(id, async () => {
    const existing = await DB.from('questions').where('questions.quizId', id).exists()
    if (existing) return c.json(await fullQuiz(id))

    const { sources, parts } = await material(id)
    if (sources.length && !parts.length && !quiz.prompt)
      throw new HTTPException(422, { message: 'None of the files could be read. Attach them again, or describe the quiz.' })
    const { data, ms, model } = await draftQuiz(String(quiz.prompt ?? ''), parts)
    const list = data.questions.map((q, i) => clean(q, i + 1))
    await saveQuestions(id, list)
    await DB.Update.table('quizzes')
      .set({ title: data.title.slice(0, 160) || 'Untitled quiz', language: data.language === 'fil' ? 'fil' : 'en' })
      .where('quizzes.id', id)
      .run()
    const result = await fullQuiz(id)
    const found = result.questions.filter((q) => q.check === 'found').length
    await addMessage(id, 'ai', data.reply, { model, ms, questions: list.length, found })
    return c.json(await fullQuiz(id))
  })
})

/**
 * A chat message: new files are added to the material, and the AI edits the
 * quiz with operations (or drafts it, if there is nothing yet).
 */
quizzes.post('/:id/chat', async (c) => {
  const quiz = await ownQuiz(Number(c.req.param('id')), c.get('user').id)
  const id = Number(quiz.id)
  const { text, ids } = await message(c, 'message')
  if (!text && !ids.length) throw new HTTPException(400, { message: 'Type a message, or attach a file.' })

  return exclusive(id, async () => {
    const attached = await attachSources(id, c.get('user').id, ids)
    await addMessage(id, 'user', text || 'Use this material too.', attached.length ? { files: names(attached) } : null)
    const { parts } = await material(id)
    const current = await fullQuiz(id)

    if (!current.questions.length) {
      const { data, ms, model } = await draftQuiz(text, parts)
      await saveQuestions(id, data.questions.map((q, i) => clean(q, i + 1)))
      await DB.Update.table('quizzes').set({ title: data.title.slice(0, 160) }).where('quizzes.id', id).run()
      await addMessage(id, 'ai', data.reply, { model, ms })
      return c.json(await fullQuiz(id))
    }

    // Each question keeps its row's id through the edit, so its answers stay
    // with it; the AI sees the questions without the ids.
    const before: Saving[] = current.questions.map(({ check: _check, file: _file, ...q }) => q)
    const { data, ms, model } = await refineQuiz(
      text || 'Use the new material too.',
      current.quiz.title,
      before.map(({ id: _id, ...q }) => q),
      parts,
    )
    // The AI rewrites a question without its picture; the picture stays.
    const after = applyOps<Saving>(
      before,
      data.ops ?? [],
      (q) => q,
      (old, q) => ({ ...q, id: old.id, image: old.image ?? null, imageAlt: old.imageAlt ?? null, imageCredit: old.imageCredit ?? null }),
    ).map((q, i) => ({ ...clean(q, i + 1), id: q.id ?? null }))
    await saveQuestions(id, after)
    if (data.title) await DB.Update.table('quizzes').set({ title: data.title.slice(0, 160) }).where('quizzes.id', id).run()
    await addMessage(id, 'ai', data.reply, { model, ms, ops: (data.ops ?? []).map((o) => o.op) })
    return c.json(await fullQuiz(id))
  })
})

/** The builder's Save: the title and the whole list of questions as edited. */
quizzes.put('/:id', async (c) => {
  const quiz = await ownQuiz(Number(c.req.param('id')), c.get('user').id)
  const id = Number(quiz.id)
  const body = await c.req.json().catch(() => ({}))
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 160) : ''
  if (!title) throw new HTTPException(400, { message: 'Give the quiz a title.' })
  if (!Array.isArray(body.questions)) throw new HTTPException(400, { message: 'The questions are missing.' })
  // The builder sends each question with the id it was loaded with; a new one has none.
  const list: Saving[] = body.questions.map((q: any, i: number) => ({ ...clean(q, i + 1), id: Number.isInteger(q?.id) ? q.id : null }))
  return exclusive(id, async () => {
    await saveQuestions(id, list)
    await DB.Update.table('quizzes').set({ title }).where('quizzes.id', id).run()
    return c.json(await fullQuiz(id))
  })
})

const SWITCHES = ['shuffleQuestions', 'shuffleOptions', 'allowRetake', 'showResults', 'showHints', 'aiCheck', 'aiEssay'] as const
const ICON_ID = /^[a-z0-9-]+:[a-z0-9-]+$/
const COLOR = /^#[0-9a-f]{6}$/i
/** The limits each time mode allows, in seconds, and the message for a limit outside them. */
const LIMITS = {
  question: { min: 10, max: 600, say: 'Use a limit between 10 seconds and 10 minutes.' },
  overall: { min: 60, max: 10_800, say: 'Use a limit between 1 minute and 3 hours.' },
}

/** The site's address, for links in email: PUBLIC_URL in production, else the address the request came to. */
const siteOf = (c: Context) => (process.env.PUBLIC_URL ?? new URL(c.req.url).origin).replace(/\/$/, '')

/**
 * Emails everyone who finished the quiz, left an address to be told of its
 * results, and has not been told yet; each address once, however many
 * attempts carry it. Answers how many addresses were told and how many
 * could not be (those stay untold, so the next release tries them again).
 */
async function tellWaiting(quiz: any, site: string) {
  const rows = await DB.from('responses').where('responses.quizId', quiz.id).and('responses.notifiedAt', null).array()
  const waiting = rows.filter((r: any) => r.status === 'finished' && typeof r.notifyEmail === 'string' && r.notifyEmail.trim())
  const link = `${site}/q/${quiz.shareCode}`
  const outcome = new Map<string, boolean>()
  for (const r of waiting as any[]) {
    const to = String(r.notifyEmail).trim().toLowerCase()
    if (!outcome.has(to)) {
      try {
        await sendMail({ to, ...resultsMail({ title: String(quiz.title), link, name: String(r.name) }) })
        outcome.set(to, true)
      } catch (e) {
        console.error('results mail:', e)
        outcome.set(to, false)
      }
    }
    if (outcome.get(to)) await DB.Update.table('responses').set({ notifiedAt: now() }).where('responses.id', r.id).run()
  }
  const told = [...outcome.values()].filter(Boolean).length
  return { told, failed: outcome.size - told }
}

/**
 * Publish, unpublish, archive or restore, and every field of the Settings
 * page. Only the fields present change. Turning `showResults` on releases
 * the results (as `POST /:id/release` does) and the reply carries `told`;
 * turning it off holds them again, from everyone, until the next release.
 */
quizzes.patch('/:id', async (c) => {
  const quiz = await ownQuiz(Number(c.req.param('id')), c.get('user').id)
  const body = await c.req.json().catch(() => ({}))
  if (!body || typeof body !== 'object') throw bad('Send the settings as a JSON object.')
  const set: Record<string, unknown> = {}
  if (body.status === 'draft' || body.status === 'published') set.status = body.status
  if (typeof body.archived === 'boolean') set.archived = body.archived

  if ('title' in body) {
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) throw bad('Give the quiz a name.')
    if (title.length > 160) throw bad('Use a name of 160 characters or fewer.')
    set.title = title
  }
  if ('description' in body) {
    if (body.description !== null && typeof body.description !== 'string') throw bad('Write the description as text.')
    const text = (body.description ?? '').trim()
    if (text.length > 1000) throw bad('Use a description of 1,000 characters or fewer.')
    set.description = text || null
  }
  if ('icon' in body) {
    const icon = typeof body.icon === 'string' ? body.icon.trim() : body.icon
    if (icon === null || icon === '') set.icon = null
    else if (typeof icon === 'string' && icon.length <= 80 && ICON_ID.test(icon)) set.icon = icon
    else throw bad('Use an icon id in the form set:name, such as fluent-emoji-flat:test-tube, or pick one from the search.')
  }
  if ('color' in body) {
    const color = typeof body.color === 'string' ? body.color.trim() : body.color
    if (color === null || color === '') set.color = null
    else if (typeof color === 'string' && COLOR.test(color)) set.color = color.toLowerCase()
    else throw bad('Use a color in the form #rrggbb, such as #2f6fdb.')
  }
  for (const k of SWITCHES)
    if (k in body) {
      if (typeof body[k] !== 'boolean') throw bad(`${k} takes true or false.`)
      set[k] = body[k]
    }
  if ('feedback' in body) {
    if (body.feedback !== 'each' && body.feedback !== 'end') throw bad('feedback takes "each" or "end".')
    set.feedback = body.feedback
  }
  if ('timeMode' in body || 'timeLimit' in body) {
    const mode = 'timeMode' in body ? body.timeMode : quiz.timeMode
    if (mode === 'none') {
      set.timeMode = 'none'
      set.timeLimit = null
    } else if (mode === 'question' || mode === 'overall') {
      const limit = 'timeLimit' in body ? body.timeLimit : quiz.timeLimit == null ? null : Number(quiz.timeLimit)
      const range = LIMITS[mode as keyof typeof LIMITS]
      if (!Number.isInteger(limit) || limit < range.min || limit > range.max) throw bad(range.say)
      set.timeMode = mode
      set.timeLimit = limit
    } else throw bad('Choose no limit, a limit for each question, or one for the whole quiz.')
  }

  if (set.status === 'published') {
    const any = await DB.from('questions').where('questions.quizId', quiz.id).exists()
    if (!any) throw new HTTPException(400, { message: 'Add at least one question before sharing the quiz.' })
  }
  // Closing the link (stop sharing, or archiving a shared quiz) pauses every
  // open attempt's overall clock: the attempt is marked with the moment, and
  // the deadline (start plus limit, see routes/public.ts) stands still while
  // the mark is set. Opening it again (sharing, or restoring) moves each
  // paused attempt's start forward by the span it waited and clears the
  // mark, so no time is lost to the pause. Attempts of a quiz without an
  // overall limit carry the mark too; it changes nothing there.
  const wasOpen = quiz.status === 'published' && !Number(quiz.archived)
  const willOpen = (set.status ?? quiz.status) === 'published' && !(set.archived ?? !!Number(quiz.archived))
  if (wasOpen && !willOpen)
    await DB.Update.table('responses')
      .set({ pausedAt: now() })
      .where('responses.quizId', quiz.id)
      .and('responses.status', 'open')
      .and('responses.pausedAt', null)
      .run()
  if (!wasOpen && willOpen) {
    const open = await DB.from('responses').where('responses.quizId', quiz.id).and('responses.status', 'open').array()
    const t = now()
    for (const r of open as any[]) {
      if (r.pausedAt == null) continue
      await DB.Update.table('responses')
        .set({ createdAt: Number(r.createdAt) + Math.max(0, t - Number(r.pausedAt)), pausedAt: null })
        .where('responses.id', r.id)
        .run()
    }
  }
  const was = !!Number(quiz.showResults)
  const release = set.showResults === true && !was
  if (release) set.resultsReleasedAt = now()
  if (set.showResults === false && was) set.resultsReleasedAt = null
  // What a list shows of the quiz counts as an edit; a switch does not.
  if ('title' in set || 'description' in set || 'icon' in set || 'color' in set) set.updatedAt = now()
  if (Object.keys(set).length) await DB.Update.table('quizzes').set(set).where('quizzes.id', quiz.id).run()
  const told = release ? (await tellWaiting({ ...quiz, ...set }, siteOf(c))).told : undefined
  return c.json({ ...(await fullQuiz(Number(quiz.id))), ...(release ? { told } : {}) })
})

/**
 * The quiz's cover: one image, shown instead of its icon on the home cards,
 * the overview and the shared quiz's page. A new upload replaces the old
 * file. Multipart, the image in `file`.
 */
quizzes.post('/:id/image', async (c) => {
  const quiz = await ownQuiz(Number(c.req.param('id')), c.get('user').id)
  const id = Number(quiz.id)
  const body = await c.req.parseBody().catch(() => {
    throw bad('The upload could not be read. Try again.')
  })
  const file = body.file
  if (!(file instanceof File)) throw bad('Choose an image to upload.')
  if (!COVER_TYPES[file.type]) throw bad(`${file.name} is not a JPG, PNG, WebP or GIF image. Choose one of those.`)
  if (file.size === 0) throw bad(`${file.name} is empty. Choose another image.`)
  if (file.size > MAX_COVER) throw bad(`${file.name} is larger than 5 MB. Choose a smaller image.`)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const ext = sniff(bytes)
  if (!ext) throw bad(`${file.name} is not a JPG, PNG, WebP or GIF image. Choose one of those.`)

  const name = `cover-${Date.now()}-${randomBytes(6).toString('hex')}.${ext}`
  await mkdir(join(UPLOADS, String(id)), { recursive: true })
  await writeFile(join(UPLOADS, String(id), name), bytes)
  await DB.Update.table('quizzes').set({ image: `${id}/${name}`, updatedAt: now() }).where('quizzes.id', id).run()
  if (typeof quiz.image === 'string' && quiz.image) await unlink(join(UPLOADS, quiz.image)).catch(() => {})
  return c.json(await fullQuiz(id), 201)
})

/** Removes the cover: the quiz shows its icon again, or its color. */
quizzes.delete('/:id/image', async (c) => {
  const quiz = await ownQuiz(Number(c.req.param('id')), c.get('user').id)
  if (typeof quiz.image === 'string' && quiz.image) {
    await DB.Update.table('quizzes').set({ image: null, updatedAt: now() }).where('quizzes.id', quiz.id).run()
    await unlink(join(UPLOADS, quiz.image)).catch(() => {})
  }
  return c.json(await fullQuiz(Number(quiz.id)))
})

/**
 * Releases held-back results: respondents can see their scores and the
 * answers from now on, and everyone who left an email is told.
 * Answers `{ releasedAt, told, failed }`.
 */
quizzes.post('/:id/release', async (c) => {
  const quiz = await ownQuiz(Number(c.req.param('id')), c.get('user').id)
  const at = now()
  await DB.Update.table('quizzes').set({ resultsReleasedAt: at }).where('quizzes.id', quiz.id).run()
  const { told, failed } = await tellWaiting(quiz, siteOf(c))
  return c.json({ releasedAt: at, told, failed })
})

quizzes.delete('/:id', async (c) => {
  const quiz = await ownQuiz(Number(c.req.param('id')), c.get('user').id)
  const sources = await loadSources(Number(quiz.id))
  await DB.Delete.from('quizzes').where('quizzes.id', quiz.id).run()
  await removeFiles(sources, Number(quiz.id))
  return c.json({ ok: true })
})

// ---- the overview ---------------------------------------------------------------

/**
 * The numbers behind a quiz's overview page: views, takers, the average, when
 * the responses came in, the questions most often missed, the latest
 * responses, and the shape of the quiz (kinds, Bloom levels, topics).
 */
quizzes.get('/:id/overview', async (c) => {
  const quiz = await ownQuiz(Number(c.req.param('id')), c.get('user').id)
  const id = Number(quiz.id)
  const full = await fullQuiz(id)
  const responses = await DB.from('responses').where('responses.quizId', id).orderBy('responses.id', 'DESC').array()
  const finished = responses.filter((r: any) => r.status === 'finished')
  const answers = await answersOf(finished.map((r: any) => Number(r.id)))

  const perQuestion = new Map<number, { answered: number; missed: number }>()
  for (const a of answers) {
    // An essay waiting for the maker's score is neither right nor wrong yet.
    if (Number(a.pending) && !Number(a.overridden)) continue
    const m = perQuestion.get(Number(a.questionId)) ?? { answered: 0, missed: 0 }
    m.answered++
    if (!Number(a.correct)) m.missed++
    perQuestion.set(Number(a.questionId), m)
  }
  const missed = full.questions
    .map((q, i) => ({ id: q.id, number: i + 1, prompt: q.prompt, kind: q.kind, topic: q.topic, ...(perQuestion.get(q.id) ?? { answered: 0, missed: 0 }) }))
    .filter((q) => q.answered > 0 && q.missed > 0)
    .sort((a, b) => b.missed / b.answered - a.missed / a.answered || b.answered - a.answered)
    .slice(0, 5)

  const pct = finished.map((r: any) => (Number(r.total) ? Number(r.score) / Number(r.total) : 0))
  const tally = (keys: string[]) => keys.reduce<Record<string, number>>((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {})
  const pending = await pendingByResponse(responses.map((r: any) => Number(r.id)))
  const oldestPending = responses
    .map((r: any) => Number(r.id))
    .filter((rid: number) => pending.has(rid))
    .at(-1)
  return c.json({
    quiz: full.quiz,
    results: {
      // Held: respondents see neither their score nor the answers yet. Nothing
      // is held until someone has finished, so a quiz with the switch off and
      // no respondents (a fresh copy, say) has no results to release.
      held: !full.quiz.showResults && full.quiz.resultsReleasedAt == null && finished.length > 0,
      releasedAt: full.quiz.resultsReleasedAt,
      // Finished respondents who left an email and have not been told.
      waiting: new Set(
        finished
          .filter((r: any) => r.notifiedAt == null && typeof r.notifyEmail === 'string' && r.notifyEmail.trim())
          .map((r: any) => String(r.notifyEmail).trim().toLowerCase()),
      ).size,
      // Essays waiting for the maker's score, and the response holding the oldest.
      pending: [...pending.values()].reduce((s, n) => s + n, 0),
      pendingIn: oldestPending ?? null,
    },
    views: Number(quiz.views ?? 0),
    takers: finished.length,
    open: responses.length - finished.length,
    average: pct.length ? pct.reduce((s: number, x: number) => s + x, 0) / pct.length : null,
    best: pct.length ? Math.max(...pct) : null,
    finishedAt: finished.map((r: any) => Number(r.finishedAt)).filter(Boolean),
    missed,
    recent: finished.slice(0, 8).map((r: any) => ({
      id: Number(r.id),
      name: String(r.name),
      score: Number(r.score),
      total: Number(r.total),
      finishedAt: Number(r.finishedAt),
      rating: r.rating == null ? null : Number(r.rating),
    })),
    shape: {
      questions: full.questions.length,
      points: full.questions.reduce((s, q) => s + q.points, 0),
      kinds: tally(full.questions.map((q) => q.kind)),
      bloom: tally(full.questions.map((q) => q.bloom)),
      topics: [...new Set(full.questions.map((q) => q.topic))],
      found: full.questions.filter((q) => q.check === 'found').length,
    },
    sources: full.sources,
    insight: quiz.insight ?? null,
    insightAt: quiz.insightAt == null ? null : Number(quiz.insightAt),
    // Reports from respondents, newest first. `question` is the reported
    // question's number in the quiz's current order, or null when the report
    // named none or the question has since been deleted.
    reports: (await DB.from('reports').where('reports.quizId', id).orderBy('reports.id', 'DESC').array()).map((r: any) => {
      const at = r.questionId == null ? -1 : full.questions.findIndex((q) => q.id === Number(r.questionId))
      return {
        id: Number(r.id),
        reason: r.reason,
        note: r.note ?? null,
        question: at === -1 ? null : at + 1,
        createdAt: Number(r.createdAt),
      }
    }),
  })
})

/**
 * How many essays wait for the maker's score in each of the given responses
 * (only those with any). A score the maker gave ends the wait whatever the
 * flag says, so an answer overridden before the flag was cleared is scored.
 */
async function pendingByResponse(responseIds: number[]) {
  const wanted = new Set(responseIds)
  const rows = await DB.from('answers')
    .select({ responseId: 'answers.responseId', n: DB.count('*') })
    .where('answers.pending', true)
    .and('answers.overridden', false)
    .groupBy('answers.responseId')
    .array()
  return new Map<number, number>(
    rows.filter((r: any) => wanted.has(Number(r.responseId))).map((r: any) => [Number(r.responseId), Number(r.n)]),
  )
}

/** The answers of the given responses. */
async function answersOf(responseIds: number[]): Promise<any[]> {
  if (!responseIds.length) return []
  const wanted = new Set(responseIds)
  const rows: any[] = []
  for (const id of wanted) rows.push(...(await DB.from('answers').where('answers.responseId', id).array()))
  return rows
}

/**
 * "What to teach again": the AI reads the questions people missed, with
 * anonymous counts (never a name), and writes a short note for the teacher
 * that cites them by number (ai/quiz.ts, `teachAgainNote`). An essay still
 * waiting for the maker's score is neither right nor wrong and is left out
 * of the counts, as the overview leaves it out.
 */
quizzes.post('/:id/insight', async (c) => {
  const quiz = await ownQuiz(Number(c.req.param('id')), c.get('user').id)
  const id = Number(quiz.id)
  const full = await fullQuiz(id)
  const finished = (await DB.from('responses').where('responses.quizId', id).array()).filter((r: any) => r.status === 'finished')
  if (!finished.length) throw new HTTPException(400, { message: 'The note needs at least one finished response.' })
  const answers = (await answersOf(finished.map((r: any) => Number(r.id)))).filter((a) => !Number(a.pending) || Number(a.overridden))
  const rows = full.questions.map((q, i) => {
    const mine = answers.filter((a) => Number(a.questionId) === q.id)
    return {
      number: i + 1,
      prompt: q.prompt,
      topic: q.topic,
      kind: q.kind,
      answered: mine.length,
      missed: mine.filter((a) => !Number(a.correct)).length,
      picks:
        q.kind === 'choice' || q.kind === 'truefalse'
          ? q.choices.map((ch, k) => ({ text: ch.text, correct: k === q.answer, n: mine.filter((a) => Number(a.choice) === k).length }))
          : [],
    }
  })
  const { data } = await teachAgainNote({ title: full.quiz.title, language: full.quiz.language, finished: finished.length, questions: rows })
  const at = Math.floor(Date.now() / 1000)
  await DB.Update.table('quizzes').set({ insight: data.note, insightAt: at }).where('quizzes.id', id).run()
  return c.json({ insight: data.note, insightAt: at })
})

/**
 * A copy of the quiz: its questions, material and settings (the cover
 * included), as a new draft. Responses and a release do not come along.
 */
quizzes.post('/:id/duplicate', async (c) => {
  const user = c.get('user')
  const quiz = await ownQuiz(Number(c.req.param('id')), user.id)
  const full = await fullQuiz(Number(quiz.id))
  const s = full.quiz
  const r = await DB.Insert.into('quizzes')
    .values({
      userId: user.id,
      title: `${s.title} (copy)`.slice(0, 160),
      shareCode: await newShareCode(),
      language: s.language,
      prompt: s.prompt,
      description: s.description,
      icon: s.icon,
      color: s.color,
      shuffleQuestions: s.shuffleQuestions,
      shuffleOptions: s.shuffleOptions,
      timeMode: s.timeMode,
      timeLimit: s.timeLimit,
      allowRetake: s.allowRetake,
      showResults: s.showResults,
      showHints: s.showHints,
      aiCheck: s.aiCheck,
      aiEssay: s.aiEssay,
      feedback: s.feedback,
    })
    .run()
  const copy = Number(r.lastInsertRowid)
  if (typeof quiz.image === 'string' && quiz.image) {
    const name = basename(quiz.image)
    await mkdir(join(UPLOADS, String(copy)), { recursive: true })
    const copied = await cp(join(UPLOADS, quiz.image), join(UPLOADS, String(copy), name)).then(
      () => true,
      () => false,
    )
    if (copied) await DB.Update.table('quizzes').set({ image: `${copy}/${name}` }).where('quizzes.id', copy).run()
  }
  const sources = await loadSources(Number(quiz.id))
  if (sources.length) {
    const dir = join(process.cwd(), 'data', 'uploads', String(copy))
    await mkdir(dir, { recursive: true })
    for (const s of sources) {
      const path = join(dir, basename(s.path))
      await cp(s.path, path)
      await DB.Insert.into('sources')
        .values({
          quizId: copy,
          userId: user.id,
          name: s.name,
          mime: s.mime,
          size: s.size,
          path,
          pages: s.pages?.length ?? null,
          text: s.pages ? JSON.stringify(s.pages) : null,
          status: s.status === 'reading' ? 'reading' : s.status,
          method: s.method,
          error: s.error,
        })
        .run()
    }
  }
  await saveQuestions(
    copy,
    full.questions.map(({ id: _i, check: _c, ...q }) => q),
  )
  return c.json({ id: copy }, 201)
})

// ---- responses ------------------------------------------------------------------

/** Every response to the quiz, newest first; `pending` counts its essays waiting for a score. */
quizzes.get('/:id/responses', async (c) => {
  const quiz = await ownQuiz(Number(c.req.param('id')), c.get('user').id)
  const rows = await DB.from('responses').where('responses.quizId', quiz.id).orderBy('responses.id', 'DESC').array()
  const pending = await pendingByResponse(rows.map((r: any) => Number(r.id)))
  return c.json({
    responses: rows.map((r: any) => ({
      id: Number(r.id),
      name: String(r.name),
      section: r.section ? String(r.section) : null,
      status: r.status,
      score: Number(r.score),
      total: Number(r.total),
      // The start of the attempt less any time it spent paused while the quiz
      // was not shared (the status change above moves it), so it is the
      // clock the time limit runs on, not the moment the respondent began.
      createdAt: Number(r.createdAt),
      finishedAt: r.finishedAt == null ? null : Number(r.finishedAt),
      rating: r.rating == null ? null : Number(r.rating),
      pending: pending.get(Number(r.id)) ?? 0,
    })),
  })
})

/** A CSV cell: quoted when it holds a comma, a quote or a line break, the quotes doubled. */
const cell = (v: unknown) => {
  const s = v == null ? '' : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** A Unix time as a local ISO date, "2026-10-02T03:50:12", the form a spreadsheet reads as a date. */
function localIso(seconds: number | null) {
  if (!seconds) return ''
  const d = new Date(seconds * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/**
 * The quiz's responses as a CSV for a spreadsheet (the DepEd e-Class Record
 * is filled by hand otherwise): a row per respondent in name order, a column
 * per question with the points that answer earned, and two header rows, the
 * second holding each question's prompt cut to 60 characters. A UTF-8 BOM in
 * front, so Excel reads the file as UTF-8 rather than the system code page.
 */
quizzes.get('/:id/responses.csv', async (c) => {
  const quiz = await ownQuiz(Number(c.req.param('id')), c.get('user').id)
  const id = Number(quiz.id)
  const full = await fullQuiz(id)
  const rows = await DB.from('responses').where('responses.quizId', id).array()
  const answers = await answersOf(rows.map((r: any) => Number(r.id)))
  const earned = new Map<string, number>(answers.map((a: any) => [`${a.responseId}:${a.questionId}`, Number(a.score)]))
  const fixed = ['Name', 'Section', 'Score', 'Total', 'Percent', 'Status', 'Started', 'Finished']
  const head = [...fixed, ...full.questions.map((_, i) => `Q${i + 1}`), 'Rating']
  const prompts = [...fixed.map(() => ''), ...full.questions.map((q) => q.prompt.slice(0, 60)), '']
  const lines = [...rows]
    .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)) || Number(a.id) - Number(b.id))
    .map((r: any) => {
      const total = Number(r.total)
      return [
        String(r.name),
        r.section ? String(r.section) : '',
        Number(r.score),
        total,
        total ? Math.round((Number(r.score) / total) * 100) : '',
        r.status === 'finished' ? 'Finished' : 'Still answering',
        localIso(Number(r.createdAt)),
        localIso(r.finishedAt == null ? null : Number(r.finishedAt)),
        ...full.questions.map((q) => earned.get(`${r.id}:${q.id}`) ?? ''),
        r.rating == null ? '' : Number(r.rating),
      ]
    })
  const csv = '﻿' + [head, prompts, ...lines].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n'
  const name = `${String(quiz.title).replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim() || 'quiz'}-responses.csv`
  const ascii = name.replace(/[^\x20-\x7e]/g, '_')
  return c.body(csv, 200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
  })
})

type Layout = { questions: number[]; options: Record<string, number[]>; key: Record<string, string> }

/** A response's `layout`, when its paper was shuffled and the value is well formed; null otherwise. */
function layoutOf(raw: unknown): Layout | null {
  let v: any = raw
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v)
    } catch {
      return null
    }
  }
  if (!v || typeof v !== 'object' || !Array.isArray(v.questions)) return null
  return {
    questions: v.questions.map(Number).filter(Number.isInteger),
    options: v.options && typeof v.options === 'object' ? v.options : {},
    key: v.key && typeof v.key === 'object' ? v.key : {},
  }
}

async function ownResponse(quizId: number, rid: number) {
  const r = Number.isFinite(rid) ? await DB.from('responses').where('responses.id', rid).fetch() : null
  if (!r || Number(r.quizId) !== quizId) throw new HTTPException(404, { message: 'This response does not exist.' })
  return r
}

/**
 * One response with every answer and its verdict, for the review screen.
 * A shuffled paper comes back as it was served: the questions in the order
 * shown, and for each, `order` (the original option indices in the order
 * shown, so the letters match the respondent's) and `key` (the correct
 * answer's letter as shown). A question the layout does not name goes at
 * the end, in the quiz's order. `choice` stays an original index.
 */
quizzes.get('/:id/responses/:rid', async (c) => {
  const quiz = await ownQuiz(Number(c.req.param('id')), c.get('user').id)
  const r = await ownResponse(Number(quiz.id), Number(c.req.param('rid')))
  const full = await fullQuiz(Number(quiz.id))
  const rows = await DB.from('answers').where('answers.responseId', r.id).array()
  const byQ = new Map(rows.map((a: any) => [Number(a.questionId), a]))
  const layout = layoutOf(r.layout)
  const rank = new Map((layout?.questions ?? []).map((qid, i) => [qid, i]))
  const ordered = full.questions
    .map((q, i) => ({ q, at: rank.get(q.id) ?? full.questions.length + i }))
    .sort((a, b) => a.at - b.at)
    .map((x) => x.q)
  /** The shown order of a question's options, when it is a true reordering of them. */
  const orderOf = (qid: number, n: number) => {
    const o = layout?.options?.[String(qid)]
    if (!Array.isArray(o) || o.length !== n) return null
    const seen = new Set(o.map(Number))
    return seen.size === n && [...seen].every((i) => Number.isInteger(i) && i >= 0 && i < n) ? o.map(Number) : null
  }
  return c.json({
    response: {
      id: Number(r.id),
      name: String(r.name),
      section: r.section ? String(r.section) : null,
      status: r.status,
      score: Number(r.score),
      total: Number(r.total),
      finishedAt: r.finishedAt == null ? null : Number(r.finishedAt),
      shuffled: !!layout,
    },
    items: ordered.map((q) => {
      const a: any = byQ.get(q.id)
      const key = layout?.key?.[String(q.id)]
      return {
        question: q,
        order: orderOf(q.id, q.choices.length),
        key: typeof key === 'string' && key ? key.slice(0, 12) : null,
        answer: a
          ? {
              id: Number(a.id),
              choice: a.choice == null ? null : Number(a.choice),
              text: a.text ?? null,
              correct: !!Number(a.correct),
              score: Number(a.score),
              verdict: a.verdict ?? null,
              byAi: !!Number(a.byAi),
              overridden: !!Number(a.overridden),
              // An essay waiting for the maker's score (essay checking is off); a
              // score the maker gave ends the wait.
              pending: !!Number(a.pending) && !Number(a.overridden),
            }
          : null,
      }
    }),
  })
})

/** Deletes one response; its answers go with it (ON DELETE CASCADE). */
quizzes.delete('/:id/responses/:rid', async (c) => {
  const quiz = await ownQuiz(Number(c.req.param('id')), c.get('user').id)
  const r = await ownResponse(Number(quiz.id), Number(c.req.param('rid')))
  await DB.Delete.from('responses').where('responses.id', r.id).run()
  return c.json({ ok: true })
})

/**
 * The quiz maker's own score for one answer: it replaces the AI's and is
 * marked as changed, and an essay that waited for it waits no longer.
 */
quizzes.patch('/:id/responses/:rid/answers/:aid', async (c) => {
  const quiz = await ownQuiz(Number(c.req.param('id')), c.get('user').id)
  const r = await ownResponse(Number(quiz.id), Number(c.req.param('rid')))
  const a = await DB.from('answers').where('answers.id', Number(c.req.param('aid'))).fetch()
  if (!a || Number(a.responseId) !== Number(r.id)) throw new HTTPException(404, { message: 'This answer does not exist.' })
  const q = (await fullQuiz(Number(quiz.id))).questions.find((x) => x.id === Number(a.questionId))!
  const body = await c.req.json().catch(() => ({}))
  const score = Number(body.score)
  if (!Number.isFinite(score) || score < 0 || score > q.points)
    throw new HTTPException(400, { message: `Give a score from 0 to ${q.points}.` })
  await DB.Update.table('answers')
    .set({ score, correct: score >= q.points * 0.6, overridden: true, pending: false })
    .where('answers.id', a.id)
    .run()
  const all = await DB.from('answers').where('answers.responseId', r.id).array()
  const total = all.reduce((s: number, x: any) => s + Number(x.score), 0)
  await DB.Update.table('responses').set({ score: total }).where('responses.id', r.id).run()
  return c.json({ score, responseScore: total })
})
