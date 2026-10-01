import { randomBytes, randomInt } from 'node:crypto'
import DB from 'bakery-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { QuestionDraft } from '../ai/quiz.ts'
import { gradeChoice, gradeEssay, gradeTyped, type Graded } from '../quiz/grade.ts'
import { coverUrl, fullQuiz, type Question } from '../quiz/store.ts'

/**
 * The respondent's side: a shared quiz, answered with a name and no account.
 * An attempt is a `responses` row plus a random token only its browser
 * holds. Answers and explanations leave the server only after the question
 * is answered, and not even then while the quiz maker holds the results.
 */
export const respond = new Hono()

const notFound = () => new HTTPException(404, { message: 'This quiz is not shared, or the link is wrong.' })

async function sharedQuiz(code: string) {
  const q = await DB.from('quizzes').where('quizzes.shareCode', code).fetch()
  if (!q || q.status !== 'published' || Number(q.archived)) throw notFound()
  return q
}

/** A Bool column as a boolean, with the column's default when the row predates it. */
const flag = (v: unknown, fallback: boolean) => (v == null ? fallback : !!Number(v))

/**
 * A quiz's settings as the respondent's routes apply them. A time mode with
 * no positive limit is no limit. Results are shown when the maker shows them
 * at once or has released them since.
 */
function rulesOf(q: any) {
  const limit = Number(q.timeLimit)
  const timed = (q.timeMode === 'question' || q.timeMode === 'overall') && Number.isInteger(limit) && limit > 0
  return {
    shuffleQuestions: flag(q.shuffleQuestions, false),
    shuffleOptions: flag(q.shuffleOptions, false),
    timeMode: (timed ? q.timeMode : 'none') as 'none' | 'question' | 'overall',
    timeLimit: timed ? limit : null,
    allowRetake: flag(q.allowRetake, true),
    results: flag(q.showResults, true) || q.resultsReleasedAt != null,
    ai: { check: flag(q.aiCheck, true), essay: flag(q.aiEssay, true) },
  }
}
type Rules = ReturnType<typeof rulesOf>

/** The quiz as a respondent may see it before answering: no answers, no reasons, no quotes. */
respond.get('/q/:code', async (c) => {
  const q = await sharedQuiz(c.req.param('code'))
  // A view is one browser: the page sends `seen=1` on every load after its
  // first, so a refresh or a resumed attempt does not count again.
  if (c.req.query('seen') !== '1')
    await DB.Update.table('quizzes').set({ views: Number(q.views ?? 0) + 1 }).where('quizzes.id', q.id).run()
  const full = await fullQuiz(Number(q.id))
  const owner = await DB.from('users').where('users.id', q.userId).fetch()
  const rules = rulesOf(q)
  return c.json({
    quiz: {
      title: full.quiz.title,
      language: full.quiz.language,
      by: owner ? String(owner.name) : null,
      questions: full.questions.length,
      points: full.questions.reduce((s, x) => s + x.points, 0),
      description: q.description ? String(q.description) : null,
      icon: q.icon ? String(q.icon) : null,
      // The cover, shown instead of the icon; its address needs no sign-in.
      image: coverUrl(Number(q.id), q.image),
      timeMode: rules.timeMode,
      timeLimit: rules.timeLimit,
      allowRetake: rules.allowRetake,
      showResults: rules.results,
      aiCheck: rules.ai.check,
      aiEssay: rules.ai.essay,
    },
    // In the quiz's own order; an attempt's layout says the order it is shown in.
    questions: full.questions.map((x) => ({
      id: x.id,
      kind: x.kind,
      prompt: x.prompt,
      choices: x.choices.map((ch) => ch.text),
      points: x.points,
      // The hint names where to look; the sentence itself comes with the feedback.
      topic: x.topic || null,
      page: x.page,
      image: x.image ?? null,
      imageAlt: x.imageAlt ?? null,
      imageCredit: x.imageCredit ?? null,
    })),
  })
})

/**
 * A report from the flag on a shared quiz's pages. Anonymous; the quiz maker
 * reads it on the overview. One address may send ten an hour, which is more
 * than a person reporting needs and less than a script flooding a quiz.
 */
const reported = new Map<string, number[]>()
respond.post('/q/:code/reports', async (c) => {
  const q = await sharedQuiz(c.req.param('code'))
  const body = await c.req.json().catch(() => ({}))
  const reason = ['wrong', 'harmful', 'copied', 'other'].includes(body.reason) ? body.reason : null
  if (!reason) throw new HTTPException(400, { message: 'Choose what is wrong with the quiz.' })
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 600) : ''
  // The question on screen when the flag was pressed, kept only if it is one of this quiz's.
  const asked = Number.isInteger(body.questionId)
    ? await DB.from('questions').where('questions.id', body.questionId).and('questions.quizId', q.id).fetch()
    : null
  const questionId = asked ? Number(asked.id) : null
  const now = Date.now()
  if (!within(reported, addressOf(c), 10, now)) throw new HTTPException(429, { message: 'Too many reports from here in the last hour. Try again later.' })
  await DB.Insert.into('reports')
    .values({ quizId: q.id, reason, note: note || null, questionId, createdAt: Math.floor(now / 1000) })
    .run()
  return c.json({ ok: true }, 201)
})

const addressOf = (c: { req: { header(name: string): string | undefined } }) =>
  c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'local'

/** Counts one request from `who` against `max` an hour; false once the hour is full. */
function within(log: Map<string, number[]>, who: string, max: number, now = Date.now()) {
  const recent = (log.get(who) ?? []).filter((t) => now - t < 3600_000)
  if (recent.length >= max) return false
  log.set(who, [...recent, now])
  return true
}

// ---- the layout: the order an attempt is shown in, kept with it -------------------

/**
 * How one attempt is laid out, saved on its `responses` row as it was served
 * so the quiz maker's views can show the response in its own order with its
 * own key. `questions`: question ids in the order shown. `options`: for each
 * multiple choice and true or false question, the original option indices in
 * the order shown. `key`: for the same questions, the right answer as shown,
 * the letter for multiple choice ("A" to "F") and the word for true or false.
 * Null on a quiz that shuffles nothing.
 */
export type Layout = { questions: number[]; options: Record<string, number[]>; key: Record<string, string> }

const LETTERS = 'ABCDEF'

/** A uniform shuffle (Fisher and Yates) of a copy. */
function shuffled<T>(list: T[]) {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/** Lays an attempt out once, when it starts. True or false keeps its order. */
function newLayout(questions: Question[], rules: Rules): Layout | null {
  if (!rules.shuffleQuestions && !rules.shuffleOptions) return null
  const layout: Layout = { questions: questions.map((q) => q.id), options: {}, key: {} }
  if (rules.shuffleQuestions) layout.questions = shuffled(layout.questions)
  for (const q of questions) {
    if (q.kind !== 'choice' && q.kind !== 'truefalse') continue
    const order = q.choices.map((_, i) => i)
    const shown = rules.shuffleOptions && q.kind === 'choice' ? shuffled(order) : order
    layout.options[q.id] = shown
    if (q.answer != null) {
      const at = shown.indexOf(q.answer)
      layout.key[q.id] = q.kind === 'choice' ? LETTERS[at]! : q.choices[q.answer]!.text
    }
  }
  return layout
}

function readLayout(v: unknown): Layout | null {
  if (v == null) return null
  try {
    const l = typeof v === 'string' ? JSON.parse(v) : v
    return l && Array.isArray(l.questions) ? (l as Layout) : null
  } catch {
    return null
  }
}

/**
 * The order an attempt is served in, from its saved layout: a question
 * deleted since drops out, one added since goes at the end in the quiz's
 * order, unshuffled. The same goes for an edited question's options. With
 * no layout, the quiz's own order.
 */
function servedOrder(layout: Layout | null, questions: Question[]) {
  const ids = new Set(questions.map((q) => q.id))
  const kept = (layout?.questions ?? []).filter((id) => ids.has(id))
  const seen = new Set(kept)
  const order = [...kept, ...questions.map((q) => q.id).filter((id) => !seen.has(id))]
  const options: Record<number, number[]> = {}
  if (layout)
    for (const q of questions) {
      const saved = layout.options[q.id]
      if (!saved) continue
      const valid = saved.filter((i) => Number.isInteger(i) && i >= 0 && i < q.choices.length)
      const rest = q.choices.map((_, i) => i).filter((i) => !valid.includes(i))
      options[q.id] = [...valid, ...rest]
    }
  return { order, options }
}

// ---- attempts ---------------------------------------------------------------------

/**
 * An overall limit is kept here, with this much allowance for the network: an
 * answer sent in the last second still lands. A per-question limit is kept by
 * the page, which moves on at zero; a total-time ceiling here would refuse
 * honest answers, since the clock stops while a respondent reads the feedback.
 */
const GRACE_MS = 30_000

/** When an attempt's overall limit runs out, in ms since the epoch; null without one. */
const deadlineOf = (r: any, rules: Rules) =>
  rules.timeMode === 'overall' && rules.timeLimit ? (Number(r.createdAt) + rules.timeLimit) * 1000 : null

/** What is left of an open attempt's overall limit, in ms; null without one. */
const timeLeft = (r: any, rules: Rules) => {
  const deadline = deadlineOf(r, rules)
  return deadline == null || r.status === 'finished' ? null : Math.max(0, deadline - Date.now())
}

respond.post('/q/:code/attempts', async (c) => {
  const q = await sharedQuiz(c.req.param('code'))
  const body = await c.req.json().catch(() => ({}))
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : ''
  if (!name) throw new HTTPException(400, { message: 'Enter your name to start.' })
  const full = await fullQuiz(Number(q.id))
  const rules = rulesOf(q)
  const layout = newLayout(full.questions, rules)
  const token = randomBytes(24).toString('base64url')
  const r = await DB.Insert.into('responses')
    .values({
      quizId: q.id,
      name,
      token,
      total: full.questions.reduce((s, x) => s + x.points, 0),
      layout: layout ? JSON.stringify(layout) : null,
    })
    .run()
  // A retake from the same browser, after a finished attempt, is a visit the
  // page load did not count (`view`), so views never fall below attempts.
  if (body.view === true)
    await DB.Update.table('quizzes').set({ views: Number(q.views ?? 0) + 1 }).where('quizzes.id', q.id).run()
  return c.json(
    {
      attempt: Number(r.lastInsertRowid),
      token,
      ...servedOrder(layout, full.questions),
      timeLeft: rules.timeMode === 'overall' ? rules.timeLimit! * 1000 : null,
    },
    201,
  )
})

/**
 * The attempt, if the token is its own; a 404 otherwise, so ids reveal
 * nothing. The page sends the token in the `x-attempt-token` header, never in
 * the address, which servers and proxies write to their logs.
 */
const tokenOf = (c: { req: { header(name: string): string | undefined } }, body?: { token?: unknown }) =>
  c.req.header('x-attempt-token') ?? body?.token

async function ownAttempt(id: number, token: unknown) {
  const r = Number.isFinite(id) ? await DB.from('responses').where('responses.id', id).fetch() : null
  if (!r || typeof token !== 'string' || !r.token || r.token !== token) throw new HTTPException(404, { message: 'This attempt does not exist.' })
  return r
}

const quizOf = (r: any) => DB.from('quizzes').where('quizzes.id', r.quizId).fetch()

type Given = { choice: number | null; text: string | null }

/** What a respondent sees once a question is answered, or, after finishing, skipped. */
function feedback(q: QuestionDraft & { id: number }, a: Given & Graded, skipped = false) {
  return {
    questionId: q.id,
    skipped,
    correct: a.correct,
    score: a.score,
    points: q.points,
    verdict: a.verdict,
    byAi: a.byAi,
    pending: !!a.pending,
    choice: a.choice,
    text: a.text,
    answer: q.kind === 'choice' || q.kind === 'truefalse' ? q.answer : null,
    accepted: q.kind === 'identify' ? q.accepted : [],
    reasons: q.choices.map((ch) => ch.why),
    explain: q.explain,
    quote: q.quote,
    page: q.page,
  }
}

/** An answer while the results are held: what was given, and nothing about how it scored. */
const saved = (q: QuestionDraft & { id: number }, a: Given) => ({
  questionId: q.id,
  skipped: false,
  held: true as const,
  points: q.points,
  choice: a.choice,
  text: a.text,
})

const graded = (row: any): Given & Graded => ({
  choice: row.choice == null ? null : Number(row.choice),
  text: row.text ?? null,
  correct: !!Number(row.correct),
  score: Number(row.score),
  verdict: row.verdict ?? null,
  byAi: !!Number(row.byAi),
  // A score the quiz maker gave settles an essay that was waiting for one.
  pending: !!Number(row.pending) && !Number(row.overridden),
})

/**
 * Where an attempt stands, for a refresh: every answer so far with its
 * feedback, in the order the attempt is shown. Once the attempt is finished,
 * the questions it skipped come too, with their answers, so the review shows
 * the whole quiz. While the results are held, the answers carry only what
 * was given, and the score stays out.
 */
respond.get('/attempts/:id', async (c) => {
  const r = await ownAttempt(Number(c.req.param('id')), tokenOf(c))
  const [full, q] = await Promise.all([fullQuiz(Number(r.quizId)), quizOf(r)])
  const rules = rulesOf(q)
  const rows = await DB.from('answers').where('answers.responseId', r.id).array()
  const given = new Map(rows.map((a: any) => [Number(a.questionId), a]))
  const finished = r.status === 'finished'
  const { order, options } = servedOrder(readLayout(r.layout), full.questions)
  const byId = new Map(full.questions.map((x) => [x.id, x]))
  const shown = order.map((id) => byId.get(id)!)
  const none = { choice: null, text: null, correct: false, score: 0, verdict: null, byAi: false }
  return c.json({
    status: r.status,
    name: String(r.name),
    held: !rules.results,
    score: rules.results ? Number(r.score) : null,
    total: Number(r.total),
    rating: r.rating == null ? null : Number(r.rating),
    order,
    options,
    timeLeft: timeLeft(r, rules),
    notify: rules.results ? null : (r.notifyEmail ?? null),
    // A question removed since it was answered drops out.
    answers: rules.results
      ? shown.flatMap((x) => {
          const a = given.get(x.id)
          if (a) return [feedback(x, graded(a))]
          return finished ? [feedback(x, none, true)] : []
        })
      : shown.flatMap((x) => {
          const a = given.get(x.id)
          return a ? [saved(x, graded(a))] : []
        }),
  })
})

/**
 * One answer: graded, stored once (a second answer to the same question gets
 * the first's reply). Past an overall limit and its grace it is refused, with
 * `field: "time"` so the page knows to finish.
 */
respond.post('/attempts/:id/answers', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const r = await ownAttempt(Number(c.req.param('id')), tokenOf(c, body))
  if (r.status === 'finished') throw new HTTPException(409, { message: 'This attempt is already finished.' })
  const [full, quiz] = await Promise.all([fullQuiz(Number(r.quizId)), quizOf(r)])
  const rules = rulesOf(quiz)
  const q = full.questions.find((x) => x.id === Number(body.questionId))
  if (!q) throw new HTTPException(404, { message: 'This question is not in the quiz.' })
  const reply = (a: Given & Graded) => (rules.results ? feedback(q, a) : saved(q, a))

  const done = await DB.from('answers').where('answers.responseId', r.id).and('answers.questionId', q.id).fetch()
  if (done) return c.json(reply(graded(done)))

  const deadline = deadlineOf(r, rules)
  if (deadline != null && Date.now() > deadline + GRACE_MS)
    return c.json({ error: 'The time for this quiz is up, so this answer was not saved.', field: 'time' }, 409)

  let result: Graded
  let choice: number | null = null
  let text: string | null = null
  if (q.kind === 'choice' || q.kind === 'truefalse') {
    choice = Number.isInteger(body.choice) ? body.choice : null
    result = gradeChoice(q, choice)
  } else {
    const typed: string = typeof body.text === 'string' ? body.text.slice(0, 8000) : ''
    text = typed
    result = q.kind === 'identify' ? await gradeTyped(q, typed, rules.ai) : await gradeEssay(q, typed, rules.ai)
  }
  await DB.Insert.into('answers')
    .values({
      responseId: r.id,
      questionId: q.id,
      choice,
      text,
      correct: result.correct,
      score: result.score,
      verdict: result.verdict,
      byAi: result.byAi,
      pending: !!result.pending,
    })
    .run()
  return c.json(reply({ choice, text, ...result }))
})

/**
 * Finishing totals the score; a rating (1 to 5) may come with it or after.
 * It works past a time limit too: a late finish is how an attempt ends when
 * the clock runs out. While the results are held, the reply says only how
 * many were answered.
 */
respond.post('/attempts/:id/finish', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const r = await ownAttempt(Number(c.req.param('id')), tokenOf(c, body))
  const rules = rulesOf(await quizOf(r))
  const rows = await DB.from('answers').where('answers.responseId', r.id).array()
  const score = rows.reduce((s: number, a: any) => s + Number(a.score), 0)
  const rating = Number.isInteger(body.rating) && body.rating >= 1 && body.rating <= 5 ? body.rating : null
  await DB.Update.table('responses')
    .set({
      status: 'finished',
      score,
      ...(rating ? { rating } : {}),
      ...(r.status === 'finished' ? {} : { finishedAt: Math.floor(Date.now() / 1000) }),
    })
    .where('responses.id', r.id)
    .run()
  if (!rules.results) return c.json({ held: true, total: Number(r.total), answered: rows.length })
  return c.json({ score, total: Number(r.total), correct: rows.filter((a: any) => Number(a.correct)).length, answered: rows.length })
})

/**
 * An email address to tell when the quiz maker releases the results, kept on
 * the attempt (a second one replaces the first). Only while the results are
 * held and the attempt is finished. Sixty an hour from one address: a class
 * on one school network leaves one each within minutes, and a script
 * collecting addresses gets no further than that.
 */
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/
const notifyLog = new Map<string, number[]>()
respond.post('/attempts/:id/notify', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const r = await ownAttempt(Number(c.req.param('id')), tokenOf(c, body))
  const rules = rulesOf(await quizOf(r))
  if (rules.results) throw new HTTPException(409, { message: 'The results are already out. Reload the page to see your score.' })
  if (r.status !== 'finished') throw new HTTPException(409, { message: 'Finish the quiz first.' })
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  if (email.length > 254 || !EMAIL.test(email))
    return c.json({ error: 'Enter an email address like name@example.com.', field: 'email' }, 400)
  if (!within(notifyLog, addressOf(c), 60)) throw new HTTPException(429, { message: 'Too many requests from here in the last hour. Try again later.' })
  await DB.Update.table('responses').set({ notifyEmail: email, notifiedAt: null }).where('responses.id', r.id).run()
  return c.json({ ok: true, email })
})
