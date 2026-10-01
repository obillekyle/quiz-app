import { generate, type Part, S } from './gemini.ts'

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
