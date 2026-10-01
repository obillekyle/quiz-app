import { generate, S } from '../ai/gemini.ts'
import type { QuestionDraft } from '../ai/quiz.ts'

/**
 * One graded answer. `byAi` marks a verdict the AI gave, shown as such;
 * `pending` an essay left for the quiz maker to score (essay checking off).
 */
export type Graded = { correct: boolean; score: number; verdict: string | null; byAi: boolean; pending?: boolean }

/**
 * What the quiz's settings allow the AI to do. `check`: an identification
 * answer that is not an exact match goes to the AI. `essay`: the AI scores
 * essays. Both default to on, as the columns do.
 */
export type AiRules = { check: boolean; essay: boolean }
const AI_ON: AiRules = { check: true, essay: true }

const NUMBERS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18',
  nineteen: '19', twenty: '20', thirty: '30', forty: '40', fifty: '50', hundred: '100',
  // Filipino
  wala: '0', isa: '1', dalawa: '2', tatlo: '3', apat: '4', lima: '5', anim: '6', pito: '7', walo: '8', siyam: '9', sampu: '10',
}

/**
 * An answer reduced to what it says: lowercase, no accents, no punctuation,
 * single spaces, number words as digits, no leading article. "The Mercury!"
 * and "mercury" become the same string, and so do "five" and "5", with no
 * AI asked.
 */
export function normalizeAnswer(s: string) {
  const words = s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    // A typed minus sign (U+2212) or en dash before a number is a minus.
    .replace(/[−–](?=\d)/g, '-')
    .replace(/[^\p{L}\p{N}\s.-]/gu, ' ')
    // A point or a hyphen stays only as part of a number: between digits, or
    // leading one ("-38.8", ".5"). The rule used to drop a leading sign, so
    // "38.8" matched an accepted "-38.8" with no AI asked.
    .replace(/(?<!\d|\s|^)[.-]|[.-](?!\d)/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => NUMBERS[w] ?? w)
  while (words.length > 1 && ['the', 'a', 'an', 'ang', 'ng', 'mga', 'si', 'sa'].includes(words[0]!)) words.shift()
  return words.join(' ')
}

export function gradeChoice(q: QuestionDraft, choice: number | null): Graded {
  const correct = choice != null && choice === q.answer
  return { correct, score: correct ? q.points : 0, verdict: null, byAi: false }
}

/**
 * An identification answer: matched by plain code first, so capitalization,
 * spacing and number words cost nothing; anything else goes to the AI, which
 * forgives spelling slips and synonyms and says why. With the AI check off,
 * the plain match is the whole check and no AI is called.
 */
export async function gradeTyped(q: QuestionDraft, text: string, rules: AiRules = AI_ON): Promise<Graded> {
  const given = normalizeAnswer(text)
  if (!given) return { correct: false, score: 0, verdict: 'No answer was given.', byAi: false }
  if (q.accepted.some((a) => normalizeAnswer(a) === given)) return { correct: true, score: q.points, verdict: null, byAi: false }
  if (!rules.check) return { correct: false, score: 0, verdict: 'It does not match an accepted answer.', byAi: false }
  try {
    const { data } = await generate<{ correct: boolean; reason: string }>({
      task: 'check',
      system:
        'You check a typed quiz answer against the accepted answers. Count it correct when it means the same thing as one of them: forgive capitalization, spacing, small spelling slips, and numbers written as words. Do not accept a different thing, a vaguer thing, or a guess that lists several things. Give the reason in one short sentence, addressed to the person who answered, in the language of the question.',
      parts: [{ text: `Question: ${q.prompt}\nAccepted answers: ${JSON.stringify(q.accepted)}\nAnswer given: ${JSON.stringify(text)}` }],
      schema: S.obj({ correct: S.bool(), reason: S.str() }),
      temperature: 0,
      // A stuck model is passed over quickly: the first check of the evening
      // waited the full 20 s on one before the next answered in 2 s.
      timeout: 8_000,
    })
    return { correct: !!data.correct, score: data.correct ? q.points : 0, verdict: data.reason, byAi: true }
  } catch {
    // The AI could not be reached: the plain check said no, so it stands, and
    // the quiz maker sees that the AI did not look.
    return { correct: false, score: 0, verdict: 'The AI could not check this answer; it did not match an accepted answer exactly.', byAi: false }
  }
}

/**
 * An essay, scored against the rubric by the AI, with feedback. Always
 * labeled as the AI's. With essay checking off it is stored unscored and
 * `pending`, for the quiz maker, and no AI is called.
 */
export async function gradeEssay(q: QuestionDraft, text: string, rules: AiRules = AI_ON): Promise<Graded> {
  if (!text.trim()) return { correct: false, score: 0, verdict: 'No answer was given.', byAi: false }
  if (!rules.essay) return { correct: false, score: 0, verdict: null, byAi: false, pending: true }
  try {
    const { data } = await generate<{ score: number; feedback: string }>({
      task: 'essay',
      system: `You score a quiz essay against its rubric. Give "score" from 0 to ${q.points} (halves allowed), following the rubric strictly. Give "feedback": two short sentences addressed to the person who wrote it, saying what earned points and what was missing, in the language of the question. Do not reward length for its own sake.`,
      parts: [{ text: `Question: ${q.prompt}\nRubric (${q.points} points): ${q.rubric}\nEssay:\n${text.slice(0, 6000)}` }],
      schema: S.obj({ score: S.num(), feedback: S.str() }),
      temperature: 0,
      timeout: 20_000,
    })
    const score = Math.max(0, Math.min(q.points, Math.round(Number(data.score) * 2) / 2))
    return { correct: score >= q.points * 0.6, score, verdict: data.feedback, byAi: true }
  } catch {
    // Pending, so the maker's count of essays waiting for a score includes it:
    // it was a 0 nobody was told about.
    return { correct: false, score: 0, verdict: 'The AI could not score this essay. The quiz maker will score it.', byAi: false, pending: true }
  }
}
