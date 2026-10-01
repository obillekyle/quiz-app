import { AiError, generate, type Part, S } from './gemini.ts'

export const KINDS = ['choice', 'truefalse', 'identify', 'essay'] as const
export const BLOOM = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'] as const

export type Kind = (typeof KINDS)[number]
export type Bloom = (typeof BLOOM)[number]

/** A question as the AI writes it and the builder edits it. */
export type QuestionDraft = {
  kind: Kind
  prompt: string
  /** choice and truefalse: the options, each with why it is right or wrong. */
  choices: { text: string; why: string }[]
  /** choice and truefalse: index of the right option; null otherwise. */
  answer: number | null
  /** identify: the right answer first, then other forms that also count. */
  accepted: string[]
  /** essay: what a full answer includes, with points per criterion. */
  rubric: string | null
  points: number
  /** Shown after answering. */
  explain: string
  topic: string
  bloom: Bloom
  /** 1-based page of the material the quote is on; null without material. */
  page: number | null
  /** The supporting sentence, word for word from the material. */
  quote: string | null
  /**
   * An illustration, kept with the question: a file under data/illustrations,
   * what it shows, and where it came from. The AI never writes these; the
   * builder does, and a chat edit keeps them.
   */
  image?: string | null
  imageAlt?: string | null
  imageCredit?: { from: 'upload' | 'module' | 'wikimedia'; text: string; url: string | null } | null
}

const QUESTION = S.obj(
  {
    kind: S.enum(KINDS),
    prompt: S.str('The question as the respondent reads it.'),
    choices: S.arr(S.obj({ text: S.str(), why: S.str('One sentence: why this option is right or wrong.') })),
    answer: S.nullable(S.int('0-based index of the correct option for choice and truefalse; null otherwise.')),
    accepted: S.arr(S.str(), 'identify only: the correct answer first, then other forms that also count.'),
    rubric: S.nullable(S.str('essay only: 2 to 4 criteria, each with its points.')),
    points: S.int(),
    explain: S.str('One or two sentences shown after answering, based on the material.'),
    topic: S.str('A short topic label, from the material’s headings.'),
    bloom: S.enum(BLOOM),
    page: S.nullable(S.int('1-based page the quote is on.')),
    quote: S.nullable(S.str('The supporting sentence, copied word for word from the material.')),
  },
  ['kind', 'prompt', 'choices', 'answer', 'accepted', 'rubric', 'points', 'explain', 'topic', 'bloom', 'page', 'quote'],
)

const RULES = `Rules for every question:
- Base it on the attached material. Copy into "quote", word for word, the one sentence from the material that supports the answer, and give its page number in "page". Never paraphrase the quote, and never add labels, brackets or slashes to it. When the support is a row of a table, quote that row's cells in order, separated by single spaces, exactly as printed. With no material attached, set quote and page to null.
- Never ask about the material's own instructions, headings or layout.
- Kinds:
  - choice: exactly 4 options in "choices", one correct; "answer" is the index (0 to 3) of the correct one. Wrong options are plausible, not silly. Every option's "why" says in one sentence why it is right or wrong, from the material.
  - truefalse: "choices" is exactly ["True", "False"] (in Filipino ["Tama", "Mali"]), each with its "why"; "answer" is 0 or 1. Do not make every statement true.
  - identify: answered with a word or short phrase. "accepted" holds the correct answer first, then other forms that also count (synonyms, the number as digits and in words, common spellings). "choices" is empty, "answer" is null.
  - essay: an open question. "rubric" lists 2 to 4 criteria, each with its points, adding up to "points" (3 to 10). "choices" and "accepted" are empty, "answer" is null.
- "points" is 1 for choice, truefalse and identify.
- "explain": one or two sentences shown after answering.
- "topic": a short label taken from the material's headings. "bloom": the level of thinking the question asks for; spread the levels instead of asking only for recall.
- Write in the language the request asks for; if it does not say, in the language of the material ("en" English, "fil" Filipino).`

export type Draft = { title: string; language: 'en' | 'fil'; reply: string; questions: QuestionDraft[] }

/**
 * A whole quiz from a request and the material (PDFs and photos sent inline).
 * Without a stated count and mix: 10 questions, mostly multiple choice with
 * two true or false and two identification; essays only when asked.
 */
export async function draftQuiz(request: string, files: Part[]) {
  const system = `You write quizzes for teachers and students in the Philippines from material they provide.

${RULES}

The quiz:
- Follow the request for the number and kinds of questions. If it does not say, write 10 questions: mostly multiple choice, with 2 true or false and 2 identification. Write essay questions only when asked.
- Order the questions as the material teaches the ideas.
- "title": a short title for the quiz.
- "reply": one or two sentences to the person who asked, saying what you made (how many questions, which kinds) and anything they should check, such as a question you could not support with a sentence from the material.`

  const parts: Part[] = [...files, { text: `Request: ${request.trim() || 'Make a quiz from this material.'}` }]
  return generate<Draft>({
    task: 'draft',
    system,
    parts,
    schema: S.obj({
      title: S.str(),
      language: S.enum(['en', 'fil']),
      reply: S.str(),
      questions: S.arr(QUESTION),
    }),
    temperature: 0.4,
  })
}

export type Op =
  | { op: 'add'; at: number; question: QuestionDraft }
  | { op: 'update'; number: number; question: QuestionDraft }
  | { op: 'remove'; number: number }
  | { op: 'move'; number: number; to: number }

export type Refine = { reply: string; title: string | null; ops: Op[] }

/**
 * Edits an existing quiz from a chat message. The AI answers with operations
 * (add, update, remove, move) rather than a whole new quiz, so changing one
 * question costs one question's worth of output, not twenty.
 */
export async function refineQuiz(message: string, title: string, questions: QuestionDraft[], material: Part[]) {
  const system = `You edit a quiz someone is building, following their message.

${RULES}

How to answer:
- Return only the operations the message needs, in "ops":
  - add: insert "question" so that it becomes number "at" (1-based) in the final quiz.
  - update: replace question "number" with "question" (give the whole question, changed).
  - remove: delete question "number".
  - move: move question "number" so that it becomes number "to".
  "number" always refers to the quiz as it is now, before any of your operations.
- "title": a new title only if the message asks for one; otherwise null.
- "reply": one or two sentences saying what you changed. If the message is not about the quiz, make no operations and say what you can help with.`

  const current = questions.map((q, i) => ({ number: i + 1, ...q }))
  const parts: Part[] = [
    ...material,
    { text: `The quiz now, titled "${title}":\n${JSON.stringify(current)}` },
    { text: `Message: ${message.trim()}` },
  ]
  const op = S.obj(
    {
      op: S.enum(['add', 'update', 'remove', 'move']),
      number: S.nullable(S.int()),
      at: S.nullable(S.int()),
      to: S.nullable(S.int()),
      question: S.nullable(QUESTION),
    },
    ['op', 'number', 'at', 'to', 'question'],
  )
  return generate<Refine>({
    task: 'edit',
    system,
    parts,
    schema: S.obj({ reply: S.str(), title: S.nullable(S.str()), ops: S.arr(op) }),
    temperature: 0.3,
  })
}

/** One question's results as the note reads them: counts only, never a name. */
export type MissRow = {
  /** 1-based, in the quiz's order. */
  number: number
  prompt: string
  topic: string
  kind: Kind
  /** Finished respondents who answered it (a skipped question is not counted). */
  answered: number
  missed: number
  /** choice and truefalse: each option with how many picked it. */
  picks: { text: string; correct: boolean; n: number }[]
}

/**
 * "What to teach again": a short note for the teacher from the questions
 * the class missed. The note names the questions by number with their miss
 * counts and says how many finished, so every claim can be checked against
 * the table on the overview; it is written about the class and the
 * material, never to the teacher. Under five finished, it opens by saying
 * the sample is too small to tell a pattern from, and reports rather than
 * generalizes. Each respondent is one row of counts: no answer text leaves
 * the server beyond the options' labels.
 */
export async function teachAgainNote(quiz: { title: string; language: 'en' | 'fil'; finished: number; questions: MissRow[] }) {
  const n = quiz.finished
  const few = n < 5
  const system = `You read the results of one quiz and write "note", a short note to help its teacher decide what to teach again.

How to write it:
- Two to four sentences. No list, no heading, no praise, no greeting.
- Cite the questions by number with their miss counts, in the form "Q3 and Q7, each missed by 4 of 12" or "Q5 (9 of 12 missed)". Every claim about what the class found hard names the question numbers it rests on. Say how many finished the quiz.
- Say which idea in the material the missed questions share, when they share one, and what is worth going over again. Where the picks show a common wrong option, name it.
- Write in the third person, about the class and the material: "the class", "respondents", "most who answered Q4". Never address the teacher; the words "you" and "your" do not appear.
- ${
    few
      ? `Only ${n} finished, too few to tell a pattern from. Open with one sentence saying so, then report what those ${n} missed as what happened, not as a trend of the class.`
      : `${n} finished, enough to speak of a pattern where several missed the same question. A question missed by one person only is not a pattern; leave it out.`
  }
- Write in ${quiz.language === 'fil' ? 'Filipino' : 'English'}, the language of the quiz.`

  const lines = quiz.questions.map((q) => {
    const picks = q.picks.length ? ` | picks: ${q.picks.map((p) => `${p.text}${p.correct ? ' (correct)' : ''}: ${p.n}`).join('; ')}` : ''
    return `Q${q.number} [${q.topic}, ${q.kind}] ${q.prompt} | answered by ${q.answered}, missed by ${q.missed}${picks}`
  })
  const text = [`Quiz: ${quiz.title}`, `Finished: ${n}`, 'Questions, with how many answered each and how many of those missed it:', ...lines].join('\n')
  return generate<{ note: string }>({
    task: 'insight',
    system,
    parts: [{ text }],
    schema: S.obj({ note: S.str('Two to four sentences citing questions by number with miss counts.') }),
    temperature: 0.3,
  })
}

/** One question of one attempt as the study note reads it: how it went, never what was typed or picked. */
export type StudyRow = {
  /** 1-based, in the order the attempt showed the questions. */
  number: number
  topic: string
  kind: Kind
  prompt: string
  points: number
  /** Points earned; said, out of `points`, for every question that was missed. */
  score: number
  /** `pending`: an essay waiting for the quiz maker's score, neither right nor missed yet. */
  outcome: 'right' | 'partial' | 'wrong' | 'skipped' | 'pending'
  /** Where the answer is in the material, when the question has a source. */
  page: number | null
  quote: string | null
}

/** The note as it is stored on the attempt and shown to the respondent. */
export type StudyNote = { strengths: string; review: { topic: string; why: string; where: string | null }[] }

type StudyQuiz = { title: string; language: 'en' | 'fil'; score: number; total: number; questions: StudyRow[] }

const missedIn = (q: StudyRow) => q.outcome === 'wrong' || q.outcome === 'partial' || q.outcome === 'skipped'
const pts = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
const outOf = (q: StudyRow) => `${pts(q.score)} of ${pts(q.points)} ${q.points === 1 ? 'point' : 'points'}`

/**
 * The whole of what the AI is sent about one attempt: the quiz's title and
 * language, the score, and a line per question with its outcome. A question
 * that was missed carries what it cost, so the note can put the costliest
 * topic first, and its page and supporting sentence, when it has them. The
 * respondent's name, section, email and answers are not in it; the function
 * is not given them.
 */
export function studyNoteRequest(quiz: StudyQuiz) {
  const lines = quiz.questions.map((q) => {
    const outcome =
      q.outcome === 'right'
        ? 'right'
        : q.outcome === 'wrong'
          ? `wrong, ${outOf(q)}`
          : q.outcome === 'partial'
            ? `partly right, ${outOf(q)}`
            : q.outcome === 'skipped'
              ? `not answered, ${outOf(q)}`
              : 'not scored yet'
    const source = !missedIn(q)
      ? ''
      : q.quote
        ? ` | material${q.page ? `, page ${q.page}` : ''}: "${q.quote}"`
        : q.page
          ? ` | material, page ${q.page}`
          : ' | no source in the material'
    return `Q${q.number} [${q.topic}, ${q.kind}] ${q.prompt} | ${outcome}${source}`
  })
  return [
    `Quiz: ${quiz.title}`,
    `Language: ${quiz.language === 'fil' ? 'Filipino' : 'English'}`,
    `Score: ${pts(quiz.score)} of ${pts(quiz.total)} points`,
    'Questions, in the order the respondent saw them, each with how it went:',
    ...lines,
  ].join('\n')
}

/**
 * "What to review": a study note for one respondent, from their own finished
 * attempt. One sentence on what they have down, then at most three topics to
 * go over, each citing its questions by number and pointing into the
 * material. It is written to the respondent, after the results are shown,
 * so it may name the idea a question turned on.
 *
 * The reply is not trusted as it comes: strings are trimmed to a line, the
 * list is cut to three, and a pointer that names a page none of the missed
 * questions carries is dropped, so a page is never invented. A reply with
 * nothing to review, when something was missed, is refused as unusable.
 */
export async function studyNote(quiz: StudyQuiz) {
  const system = `You read one respondent's results on a quiz and write them a short study note: what they have down, what to review, and where in the material to look.

How to write it:
- "strengths": one sentence naming the topics of the questions answered right. With no question answered right, one sentence saying the review below is where to start.
- "review": the topics to go over again, three at most, the one that cost the most points first. Each item is one topic; questions missed on the same idea go into one item. Every question marked wrong, partly right or not answered was missed and belongs in an item: a question left unanswered counts as much as a wrong one. With more than three topics missed, keep the three that cost the most points. A question marked "not scored yet" is an essay waiting for the quiz maker's score: leave it out.
  - "topic": a short label for the topic, as the questions give it.
  - "why": one sentence on what was missed, citing the question numbers it rests on in the form "Q3 and Q7". Say what the material says on the point, from the supporting sentence, not only that the questions were missed.
  - "where": where in the material to look, from the page and the supporting sentence given with the item's questions, in the form "page 2, the part on alloys". Null when none of the item's questions has a source. Never name a page that is not given with one of the item's questions.
- Write to the respondent, in the second person: "you answered", "look again at". Plain and specific. No praise padding, no scolding, no greeting, no exclamation marks. Commas and full stops, never dashes.
- The respondent has been shown the results and the answers of every question listed. Say nothing about the quiz beyond what the lines give.
- Write in ${quiz.language === 'fil' ? 'Filipino' : 'English'}, the language of the quiz.`

  const res = await generate<StudyNote>({
    task: 'insight',
    system,
    parts: [{ text: studyNoteRequest(quiz) }],
    schema: S.obj({
      strengths: S.str('One sentence naming the topics answered right.'),
      review: S.arr(
        S.obj({
          topic: S.str('A short topic label.'),
          why: S.str('One sentence on what was missed, citing question numbers as "Q3 and Q7".'),
          where: S.nullable(S.str('As "page 2, the part on alloys"; null without a source.')),
        }),
        'At most three items, the most costly first.',
      ),
    }),
    temperature: 0.3,
  })

  const line = (v: unknown, max: number) =>
    typeof v === 'string' ? v.replace(/\s*—\s*|\s+–\s+/g, ', ').replace(/\s+/g, ' ').trim().slice(0, max) : ''
  const pages = new Set(quiz.questions.filter((q) => missedIn(q) && q.page != null).map((q) => q.page))
  const known = (where: string) => [...where.matchAll(/\b(?:pages?|pahina)\s*(\d+)/gi)].every((m) => pages.has(Number(m[1])))
  const review = (Array.isArray(res.data?.review) ? res.data.review : [])
    .map((x) => {
      const where = line(x?.where, 200)
      return { topic: line(x?.topic, 120), why: line(x?.why, 400), where: where && known(where) ? where : null }
    })
    .filter((x) => x.topic && x.why)
    .slice(0, 3)
  const strengths = line(res.data?.strengths, 400)
  if (!strengths || !review.length) throw new AiError('The AI did not write a usable note. Try again.', 502)
  return { ...res, data: { strengths, review } satisfies StudyNote }
}

/**
 * Applies operations to a list. Numbers refer to the list before any
 * operation, as the AI was told, so each question is tracked by its original
 * place while the list changes underneath.
 */
export function applyOps<T>(list: T[], ops: Op[], make: (q: QuestionDraft) => T, update: (old: T, q: QuestionDraft) => T) {
  type Slot = { orig: number | null; item: T; gone?: boolean }
  let slots: Slot[] = list.map((item, i) => ({ orig: i + 1, item }))
  const find = (n: number | null | undefined) => slots.find((s) => s.orig === n && !s.gone)

  for (const o of ops) if (o.op === 'update' && o.question) { const s = find(o.number); if (s) s.item = update(s.item, o.question) }
  for (const o of ops) if (o.op === 'remove') { const s = find(o.number); if (s) s.gone = true }
  slots = slots.filter((s) => !s.gone)
  for (const o of ops)
    if (o.op === 'move') {
      const s = find(o.number)
      if (!s || !o.to) continue
      slots.splice(slots.indexOf(s), 1)
      slots.splice(Math.max(0, Math.min(slots.length, o.to - 1)), 0, s)
    }
  for (const o of ops)
    if (o.op === 'add' && o.question) {
      const at = Math.max(0, Math.min(slots.length, (o.at ?? slots.length + 1) - 1))
      slots.splice(at, 0, { orig: null, item: make(o.question) })
    }
  return slots.map((s) => s.item)
}
