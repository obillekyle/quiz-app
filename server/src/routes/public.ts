import { randomBytes, randomInt } from 'node:crypto'
import DB from 'bakery-orm'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { studyNote, type QuestionDraft, type StudyNote, type StudyRow } from '../ai/quiz.ts'
import { addressOf, within } from '../limits.ts'
import { gradeChoice, gradeEssay, gradeTyped, type Graded } from '../quiz/grade.ts'
import { gradeInSet, setsOf } from '../quiz/sets.ts'
import { coverUrl, fullQuiz, type Question } from '../quiz/store.ts'

export const respond = new Hono()

const notFound = () => new HTTPException(404, { message: 'This quiz is not shared, or the link is wrong.' })

async function sharedQuiz(code: string) {
  const q = await DB.from('quizzes').where('quizzes.shareCode', code).fetch()
  if (!q || q.status !== 'published' || Number(q.archived)) throw notFound()
  return q
}

/** A Bool column as a boolean, with the column's default when the row predates it. */
const flag = (v: unknown, fallback: boolean) => (v == null ? fallback : !!Number(v))

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
    // Off, the question's "Show hint" (its topic and page) is not offered.
    hints: flag(q.showHints, true),
    ai: { check: flag(q.aiCheck, true), essay: flag(q.aiEssay, true) },
    feedback: (q.feedback === 'end' ? 'end' : 'each') as 'each' | 'end',
  }
}
type Rules = ReturnType<typeof rulesOf>

/** The quiz as a respondent may see it before answering: no answers, no reasons, no quotes. */
respond.get('/q/:code', async (c) => {
  const q = await sharedQuiz(c.req.param('code'))
  if (c.req.query('seen') !== '1')
    await DB.Update.table('quizzes').set({ views: Number(q.views ?? 0) + 1 }).where('quizzes.id', q.id).run()
  const full = await fullQuiz(Number(q.id))
  const owner = await DB.from('users').where('users.id', q.userId).fetch()
  const rules = rulesOf(q)
  const inSets = setsOf(full.questions)
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
      // The page's accent; null leaves the student purple.
      color: typeof q.color === 'string' && q.color ? String(q.color) : null,
      timeMode: rules.timeMode,
      timeLimit: rules.timeLimit,
      allowRetake: rules.allowRetake,
      showResults: rules.results,
      showHints: rules.hints,
      aiCheck: rules.ai.check,
      aiEssay: rules.ai.essay,
      feedback: rules.feedback,
    },
    // In the quiz's own order; an attempt's layout says the order it is shown in.
    questions: full.questions.map((x) => ({
      id: x.id,
      kind: x.kind,
      prompt: x.prompt,
      choices: x.choices.map((ch) => ch.text),
      points: x.points,
      topic: rules.hints ? x.topic || null : null,
      page: rules.hints ? x.page : null,
      image: x.image ?? null,
      imageAlt: x.imageAlt ?? null,
      imageCredit: x.imageCredit ?? null,
      set: inSets.member.get(x.id) ?? null,
      entry: inSets.entries.get(x.id) ?? null,
    })),
    sets: inSets.sets,
  })
})

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

/** Attempts started from one address. */
const starts = new Map<string, number[]>()
/** Typed answers and essays graded for one address; each may be an AI call. */
const typedFrom = new Map<string, number[]>()
/** Times one answer was replaced on a quiz checked at the end; each typed one is graded again. */
const changes = new Map<string, number>()
const MAX_CHANGES = 8

// ---- the layout: the order an attempt is shown in, kept with it -------------------

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

const GRACE_MS = 30_000

const deadlineOf = (r: any, rules: Rules) => {
  if (rules.timeMode !== 'overall' || !rules.timeLimit) return null
  const paused = r.pausedAt == null ? 0 : Math.max(0, Math.floor(Date.now() / 1000) - Number(r.pausedAt))
  return (Number(r.createdAt) + paused + rules.timeLimit) * 1000
}

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
  if (!within(starts, addressOf(c), 600))
    throw new HTTPException(429, { message: 'Too many attempts were started from here in the last hour. Try again later.' })
  // The section is optional ("7 Sampaguita"); an empty one is stored as null.
  const section = typeof body.section === 'string' ? body.section.trim().slice(0, 80) : ''
  const full = await fullQuiz(Number(q.id))
  const rules = rulesOf(q)
  const layout = newLayout(full.questions, rules)
  const token = randomBytes(24).toString('base64url')
  const r = await DB.Insert.into('responses')
    .values({
      quizId: q.id,
      name,
      section: section || null,
      token,
      total: full.questions.reduce((s, x) => s + x.points, 0),
      layout: layout ? JSON.stringify(layout) : null,
    })
    .run()
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

const pick = (q: QuestionDraft & { id: number }, a: Given) => ({
  questionId: q.id,
  pick: true as const,
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

respond.get('/attempts/:id', async (c) => {
  const r = await ownAttempt(Number(c.req.param('id')), tokenOf(c))
  const [full, q] = await Promise.all([fullQuiz(Number(r.quizId)), quizOf(r)])
  const rules = rulesOf(q)
  const rows = await DB.from('answers').where('answers.responseId', r.id).array()
  const given = new Map(rows.map((a: any) => [Number(a.questionId), a]))
  const finished = r.status === 'finished'
  const picking = rules.feedback === 'end' && !finished
  const { order, options } = servedOrder(readLayout(r.layout), full.questions)
  const byId = new Map(full.questions.map((x) => [x.id, x]))
  const shown = order.map((id) => byId.get(id)!)
  const none = { choice: null, text: null, correct: false, score: 0, verdict: null, byAi: false }
  return c.json({
    status: r.status,
    name: String(r.name),
    section: r.section ? String(r.section) : null,
    held: !rules.results,
    score: rules.results && !picking ? Number(r.score) : null,
    total: Number(r.total),
    rating: r.rating == null ? null : Number(r.rating),
    order,
    options,
    timeLeft: timeLeft(r, rules),
    notify: rules.results ? null : (r.notifyEmail ?? null),
    // The study note, once written, for a finished attempt whose results show.
    advice: finished && rules.results ? readAdvice(r.advice) : null,
    // A question removed since it was answered drops out.
    answers: picking
      ? shown.flatMap((x) => {
          const a = given.get(x.id)
          return a ? [pick(x, graded(a))] : []
        })
      : rules.results
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

respond.post('/attempts/:id/answers', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const r = await ownAttempt(Number(c.req.param('id')), tokenOf(c, body))
  if (r.status === 'finished') throw new HTTPException(409, { message: 'This attempt is already finished.' })
  const [full, quiz] = await Promise.all([fullQuiz(Number(r.quizId)), quizOf(r)])
  if (quiz.status !== 'published' || Number(quiz.archived))
    return c.json({ error: 'This quiz is closed, so this answer was not saved. Ask the quiz maker.', field: 'closed' }, 409)
  const rules = rulesOf(quiz)
  const q = full.questions.find((x) => x.id === Number(body.questionId))
  if (!q) throw new HTTPException(404, { message: 'This question is not in the quiz.' })
  const atEnd = rules.feedback === 'end'
  const reply = (a: Given & Graded) => (atEnd ? pick(q, a) : rules.results ? feedback(q, a) : saved(q, a))

  let choice: number | null = null
  let text: string | null = null
  if (q.kind === 'choice' || q.kind === 'truefalse') choice = Number.isInteger(body.choice) ? body.choice : null
  else text = typeof body.text === 'string' ? body.text.slice(0, q.kind === 'identify' ? 200 : 8000) : ''

  const done = await DB.from('answers').where('answers.responseId', r.id).and('answers.questionId', q.id).fetch()
  if (done) {
    const before = graded(done)
    if (!atEnd || (before.choice === choice && (before.text ?? null) === text)) return c.json(reply(before))
  }

  const deadline = deadlineOf(r, rules)
  if (deadline != null && Date.now() > deadline + GRACE_MS)
    return c.json({ error: 'The time for this quiz is up, so this answer was not saved.', field: 'time' }, 409)

  if (done) {
    const key = `${r.id}:${q.id}`
    const n = (changes.get(key) ?? 0) + 1
    if (n > MAX_CHANGES)
      return c.json({ error: 'This answer has been changed too many times. The last one saved is kept.', field: 'changes' }, 429)
    changes.set(key, n)
  }
  if ((q.kind === 'identify' || q.kind === 'essay') && !within(typedFrom, addressOf(c), 2000))
    return c.json({ error: 'Too many answers were sent from here in the last hour. Try again in a few minutes.', field: 'busy' }, 429)

  const inSet = q.itemSet && setsOf(full.questions).member.has(q.id) ? q.itemSet.style : null
  const result: Graded =
    q.kind === 'choice' || q.kind === 'truefalse'
      ? gradeChoice(q, choice)
      : q.kind === 'identify'
        ? inSet
          ? gradeInSet(q, inSet, text ?? '')
          : await gradeTyped(q, text ?? '', rules.ai)
        : await gradeEssay(q, text ?? '', rules.ai)
  const row = {
    choice,
    text,
    correct: result.correct,
    score: result.score,
    verdict: result.verdict,
    byAi: result.byAi,
    pending: !!result.pending,
  }
  if (done) {
    // A replaced answer starts over: a score the quiz maker gave belonged to the answer it replaces.
    await DB.Update.table('answers').set({ ...row, overridden: false }).where('answers.id', done.id).run()
  } else {
    const raced = await DB.from('answers').where('answers.responseId', r.id).and('answers.questionId', q.id).fetch()
    if (raced && atEnd) await DB.Update.table('answers').set({ ...row, overridden: false }).where('answers.id', raced.id).run()
    else if (raced) return c.json(reply(graded(raced)))
    else await DB.Insert.into('answers').values({ responseId: r.id, questionId: q.id, ...row }).run()
  }
  return c.json(reply({ choice, text, ...result }))
})

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
  const totals = { score, total: Number(r.total), correct: rows.filter((a: any) => Number(a.correct)).length, answered: rows.length }
  if (rules.feedback !== 'end') return c.json(totals)
  const full = await fullQuiz(Number(r.quizId))
  const given = new Map(rows.map((a: any) => [Number(a.questionId), a]))
  const byId = new Map(full.questions.map((x) => [x.id, x]))
  const none = { choice: null, text: null, correct: false, score: 0, verdict: null, byAi: false }
  return c.json({
    ...totals,
    answers: servedOrder(readLayout(r.layout), full.questions).order.map((id) => {
      const x = byId.get(id)!
      const a = given.get(id)
      return a ? feedback(x, graded(a)) : feedback(x, none, true)
    }),
  })
})

// ---- the study note ---------------------------------------------------------------

/** A stored note, read back; null when there is none or it does not parse. */
function readAdvice(v: unknown): StudyNote | null {
  if (typeof v !== 'string' || !v) return null
  try {
    const n = JSON.parse(v)
    return n && typeof n.strengths === 'string' && Array.isArray(n.review) ? (n as StudyNote) : null
  } catch {
    return null
  }
}

export function studyRows(shown: Question[], given: Map<number, any>): StudyRow[] {
  return shown.map((q, i) => {
    const row = given.get(q.id)
    const a = row ? graded(row) : null
    const outcome: StudyRow['outcome'] =
      !a || (a.choice == null && !a.text?.trim())
        ? 'skipped'
        : a.pending
          ? 'pending'
          : a.score >= q.points
            ? 'right'
            : a.score > 0
              ? 'partial'
              : 'wrong'
    return { number: i + 1, topic: q.topic, kind: q.kind, prompt: q.prompt, points: q.points, score: a ? a.score : 0, outcome, page: q.page, quote: q.quote }
  })
}

/** The note when nothing was missed: written here, in the quiz's language, with no AI asked. */
const NOTHING_MISSED = {
  en: 'You answered every question right, so there is nothing to review.',
  fil: 'Tama ang sagot mo sa bawat tanong, kaya wala kang kailangang balikan.',
}
/** The same, while an essay still waits for the quiz maker's score. */
const NOTHING_MISSED_YET = {
  en: 'Every question scored so far is right. An essay still waits for the quiz maker’s score.',
  fil: 'Tama ang lahat ng tanong na may marka na. May sanaysay pang naghihintay ng marka mula sa gumawa ng quiz.',
}

/** Notes being written, by attempt: a second request while one runs waits for the same note. */
const writing = new Map<number, Promise<StudyNote>>()
const adviceLog = new Map<string, number[]>()

respond.post('/attempts/:id/advice', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const r = await ownAttempt(Number(c.req.param('id')), tokenOf(c, body))
  const rules = rulesOf(await quizOf(r))
  if (r.status !== 'finished') throw new HTTPException(409, { message: 'Finish the quiz first. The study note is written from a finished attempt.' })
  if (!rules.results) throw new HTTPException(409, { message: 'The study note comes with the results, and the quiz maker has not released them yet.' })
  const kept = readAdvice(r.advice)
  if (kept) return c.json({ advice: kept })

  const id = Number(r.id)
  const full = await fullQuiz(Number(r.quizId))
  const rows = await DB.from('answers').where('answers.responseId', id).array()
  const given = new Map(rows.map((a: any) => [Number(a.questionId), a]))
  const byId = new Map(full.questions.map((x) => [x.id, x]))
  const shown = servedOrder(readLayout(r.layout), full.questions).order.map((qid) => byId.get(qid)!)
  const questions = studyRows(shown, given)
  const language = full.quiz.language === 'fil' ? 'fil' : 'en'
  const keep = (note: StudyNote) =>
    DB.Update.table('responses').set({ advice: JSON.stringify(note), adviceAt: Math.floor(Date.now() / 1000) }).where('responses.id', id).run()

  if (!questions.some((q) => q.outcome === 'wrong' || q.outcome === 'partial' || q.outcome === 'skipped')) {
    const waits = questions.some((q) => q.outcome === 'pending')
    const note: StudyNote = { strengths: (waits ? NOTHING_MISSED_YET : NOTHING_MISSED)[language], review: [] }
    if (!waits) await keep(note)
    return c.json({ advice: note })
  }

  let job = writing.get(id)
  if (!job) {
    if (!within(adviceLog, addressOf(c), 60)) throw new HTTPException(429, { message: 'Too many study notes from here in the last hour. Try again later.' })
    job = (async () => {
      const { data } = await studyNote({ title: full.quiz.title, language, score: Number(r.score), total: Number(r.total), questions })
      await keep(data)
      return data
    })().finally(() => writing.delete(id))
    writing.set(id, job)
  }
  return c.json({ advice: await job })
})

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
