import { randomBytes } from 'node:crypto'
import DB from 'bakery-orm'
import { HTTPException } from 'hono/http-exception'
import { ground } from '../ai/ground.ts'
import { NAME as ILLUSTRATION } from './illustrate.ts'
import { BLOOM, KINDS, type QuestionDraft } from '../ai/quiz.ts'
import { allPages, loadSources, type Source } from './sources.ts'

/** A question as the builder sees it: the AI's shape plus its id and the check. */
export type Question = QuestionDraft & {
  id: number
  /**
   * found: the quote is in the file. missing: the file has text and the quote
   * is not in it. photo: the material is photos, so a person checks by eye.
   * none: there is no material to check against.
   */
  check: 'found' | 'missing' | 'photo' | 'none'
  /** The file the quote was found in, when it was found. */
  file: string | null
}

const json = <T>(v: unknown, fallback: T): T => {
  if (v == null) return fallback
  if (typeof v !== 'string') return v as T
  try {
    return JSON.parse(v) as T
  } catch {
    return fallback
  }
}

export function checkFor(grounded: boolean, sources: Source[]): Question['check'] {
  if (grounded) return 'found'
  if (sources.some((s) => s.pages?.length)) return 'missing'
  if (sources.length) return 'photo'
  return 'none'
}

/** A free share code: 8 URL-safe characters. */
export async function newShareCode() {
  for (;;) {
    const code = randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').slice(0, 8)
    if (!(await DB.from('quizzes').where('quizzes.shareCode', code).exists())) return code
  }
}

/** The quiz if it is this user's; a 404 otherwise, so ids reveal nothing. */
export async function ownQuiz(id: number, userId: number) {
  const q = Number.isFinite(id) ? await DB.from('quizzes').where('quizzes.id', id).fetch() : null
  if (!q || Number(q.userId) !== userId) throw new HTTPException(404, { message: 'This quiz does not exist.' })
  return q
}

/**
 * The cover's address. `image` holds the file's path under data/uploads
 * (`<quizId>/cover-<time>-<random>.<ext>`); the address carries the file's
 * name, which is unguessable and new on every upload, so it can be served
 * without a session (the shared quiz's page shows it) and cached for good.
 */
export const coverUrl = (quizId: number, image: unknown) =>
  typeof image === 'string' && image ? `/api/quizzes/${quizId}/image/${image.split('/').pop()}` : null

/**
 * A quiz's Settings page, as every reader of a quiz gets it: the builder,
 * the home list, the overview and the shared quiz's page.
 */
export function settingsOf(q: any) {
  const mode = q.timeMode === 'question' || q.timeMode === 'overall' ? q.timeMode : 'none'
  return {
    description: q.description ?? null,
    icon: q.icon ?? null,
    image: coverUrl(Number(q.id), q.image),
    shuffleQuestions: !!Number(q.shuffleQuestions),
    shuffleOptions: !!Number(q.shuffleOptions),
    timeMode: mode as 'none' | 'question' | 'overall',
    // Seconds: for each question, or for the whole quiz. Null with no limit.
    timeLimit: mode === 'none' || q.timeLimit == null ? null : Number(q.timeLimit),
    allowRetake: !!Number(q.allowRetake),
    showResults: !!Number(q.showResults),
    // A row from before the column has no value; the column's default is on.
    showHints: q.showHints == null ? true : !!Number(q.showHints),
    resultsReleasedAt: q.resultsReleasedAt == null ? null : Number(q.resultsReleasedAt),
    aiCheck: !!Number(q.aiCheck),
    aiEssay: !!Number(q.aiEssay),
  }
}

/** Everything the builder needs in one answer. */
export async function fullQuiz(id: number) {
  const [quiz, rows, sources, messages] = await Promise.all([
    DB.from('quizzes').where('quizzes.id', id).fetch(),
    DB.from('questions').where('questions.quizId', id).orderBy('questions.position').array(),
    loadSources(id),
    DB.from('messages').where('messages.quizId', id).orderBy('messages.id').array(),
  ])
  return {
    quiz: {
      id: Number(quiz.id),
      title: String(quiz.title),
      language: quiz.language,
      status: quiz.status,
      archived: !!Number(quiz.archived),
      shareCode: String(quiz.shareCode),
      prompt: quiz.prompt ?? null,
      createdAt: Number(quiz.createdAt),
      updatedAt: Number(quiz.updatedAt),
      ...settingsOf(quiz),
    },
    questions: rows.map((r: any): Question => ({
      id: Number(r.id),
      kind: r.kind,
      prompt: String(r.prompt),
      choices: json(r.choices, []),
      answer: r.answer == null ? null : Number(r.answer),
      accepted: json(r.accepted, []),
      rubric: r.rubric ?? null,
      points: Number(r.points ?? 1),
      explain: r.explain ?? '',
      topic: String(r.topic),
      bloom: r.bloom,
      page: r.sourcePage == null ? null : Number(r.sourcePage),
      quote: r.sourceQuote ?? null,
      check: checkFor(!!Number(r.grounded), sources),
      file: r.sourceFile ?? null,
      image: r.image ?? null,
      imageAlt: r.imageAlt ?? null,
      imageCredit: json(r.imageCredit, null),
    })),
    sources: sources.map((s) => ({
      id: s.id,
      name: s.name,
      mime: s.mime,
      size: s.size,
      pages: s.pages?.length ?? null,
      status: s.status,
      method: s.method,
      error: s.error,
    })),
    messages: messages.map((m: any) => ({
      id: Number(m.id),
      role: m.role,
      text: String(m.text),
      meta: json(m.meta, null),
      createdAt: Number(m.createdAt),
    })),
  }
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const bad = (message: string) => new HTTPException(400, { message })

/**
 * Makes a question safe to store, whoever wrote it (the AI or the builder):
 * the kind's own rules enforced, the rest given sensible defaults.
 */
export function clean(q: any, n: number): QuestionDraft {
  const kind = KINDS.includes(q?.kind) ? q.kind : 'choice'
  const prompt = str(q?.prompt, 2000)
  if (!prompt) throw bad(`Question ${n} needs its question text.`)
  let choices: { text: string; why: string }[] = Array.isArray(q?.choices)
    ? q.choices.map((c: any) => ({ text: str(c?.text, 500), why: str(c?.why, 1000) })).filter((c: any) => c.text)
    : []
  let answer: number | null = Number.isInteger(q?.answer) ? q.answer : null
  let accepted: string[] = Array.isArray(q?.accepted) ? q.accepted.map((a: any) => str(a, 200)).filter(Boolean) : []
  let rubric: string | null = str(q?.rubric, 2000) || null
  let points = Number.isInteger(q?.points) ? Math.min(20, Math.max(1, q.points)) : 1

  if (kind === 'choice') {
    if (choices.length < 2) throw bad(`Question ${n} needs at least two options.`)
    choices = choices.slice(0, 6)
    if (answer == null || answer < 0 || answer >= choices.length) throw bad(`Mark the correct option in question ${n}.`)
    accepted = []
    rubric = null
  } else if (kind === 'truefalse') {
    if (choices.length !== 2) choices = [{ text: 'True', why: '' }, { text: 'False', why: '' }]
    if (answer !== 0 && answer !== 1) throw bad(`Mark question ${n} as true or false.`)
    accepted = []
    rubric = null
  } else if (kind === 'identify') {
    if (!accepted.length) throw bad(`Give the answer to question ${n}.`)
    choices = []
    answer = null
    rubric = null
  } else {
    choices = []
    answer = null
    accepted = []
    if (!rubric) throw bad(`Question ${n} is an essay: describe what a full answer includes (the rubric).`)
    points = Math.max(points, 2)
  }

  return {
    kind,
    prompt,
    choices,
    answer,
    accepted,
    rubric,
    points,
    explain: str(q?.explain, 2000),
    topic: str(q?.topic, 120) || 'General',
    bloom: BLOOM.includes(q?.bloom) ? q.bloom : 'remember',
    page: Number.isInteger(q?.page) ? q.page : null,
    quote: str(q?.quote, 2000) || null,
    ...picture(q),
  }
}

/** The question's illustration, when it names a stored file; nothing otherwise. */
function picture(q: any): Pick<QuestionDraft, 'image' | 'imageAlt' | 'imageCredit'> {
  const image = typeof q?.image === 'string' && ILLUSTRATION.test(q.image) ? q.image : null
  if (!image) return { image: null, imageAlt: null, imageCredit: null }
  const c = q.imageCredit
  const from = c?.from === 'upload' || c?.from === 'module' || c?.from === 'wikimedia' ? c.from : null
  return {
    image,
    imageAlt: str(q.imageAlt, 300) || null,
    imageCredit: from
      ? { from, text: str(c.text, 300), url: typeof c.url === 'string' && c.url.startsWith('https://') ? c.url.slice(0, 500) : null }
      : null,
  }
}

/**
 * Replaces a quiz's questions, grounding each quote against the material's
 * pages. A found quote takes the page it was found on, which may correct the
 * page the AI gave.
 */
export async function saveQuestions(quizId: number, list: QuestionDraft[]) {
  const sources = await loadSources(quizId)
  const pages = allPages(sources)
  const texts = pages.map((p) => p.text)
  await DB.transaction(async () => {
    await DB.Delete.from('questions').where('questions.quizId', quizId).run()
    for (const [i, q] of list.entries()) {
      const g = ground(q.quote, texts, null)
      const where = g.found && g.page ? pages[g.page - 1] : null
      await DB.Insert.into('questions')
        .values({
          quizId,
          position: i,
          kind: q.kind,
          prompt: q.prompt,
          choices: JSON.stringify(q.choices),
          answer: q.answer,
          accepted: JSON.stringify(q.accepted),
          rubric: q.rubric,
          points: q.points,
          explain: q.explain,
          topic: q.topic,
          bloom: q.bloom,
          sourcePage: where ? where.page : q.page,
          sourceQuote: q.quote,
          sourceFile: where ? where.source.name.slice(0, 255) : null,
          grounded: g.found,
          image: q.image ?? null,
          imageAlt: q.imageAlt ?? null,
          imageCredit: q.imageCredit ? JSON.stringify(q.imageCredit) : null,
        })
        .run()
    }
    await DB.Update.table('quizzes').set({ updatedAt: Math.floor(Date.now() / 1000) }).where('quizzes.id', quizId).run()
  })
}

export async function addMessage(quizId: number, role: 'user' | 'ai', text: string, meta: object | null = null) {
  await DB.Insert.into('messages')
    .values({ quizId, role, text, meta: meta ? JSON.stringify(meta) : null })
    .run()
}

/** One AI job per quiz at a time: a second request while one runs is turned away. */
const busy = new Set<number>()
export async function exclusive<T>(quizId: number, job: () => Promise<T>): Promise<T> {
  if (busy.has(quizId)) throw new HTTPException(409, { message: 'The AI is still working on this quiz. Wait for it to finish.' })
  busy.add(quizId)
  try {
    return await job()
  } finally {
    busy.delete(quizId)
  }
}
