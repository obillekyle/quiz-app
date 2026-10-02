import { describe, expect, test } from 'bun:test'
import { ground, normalize } from './ai/ground.ts'
import { applyOps, type Op, type QuestionDraft } from './ai/quiz.ts'
import { addressOf, within } from './limits.ts'
import { gradeChoice, normalizeAnswer } from './quiz/grade.ts'

const PAGE =
  'Most metals are solid at room temperature. Mercury is the only metal that is liquid at room temperature. ' +
  'It melts at about -38.8 °C, well below the freezing point of water.'

describe('the grounding check', () => {
  test('a sentence copied from the page is found, on that page', () => {
    expect(ground('Mercury is the only metal that is liquid at room temperature.', ['Cover page.', PAGE])).toEqual({ found: true, page: 2 })
  })
  test('case, curly quotes and line breaks do not hide it', () => {
    expect(ground('MERCURY is the only metal that is\nliquid at room temperature', [PAGE]).found).toBe(true)
    expect(normalize('“Brass”  —  an­alloy')).toBe('"brass" - analloy')
  })
  test('a word the text layer split still passes at 85% of the words in order', () => {
    const split = PAGE.replace('temperature. Mercury', 'tem perature. Mercury').replace('liquid at room', 'liq uid at room')
    expect(ground('Mercury is the only metal that is liquid at room temperature.', [split]).found).toBe(true)
  })
  test('a sentence that is not there is not found', () => {
    expect(ground('Gallium is the only metal that conducts sound in a vacuum.', [PAGE])).toEqual({ found: false, page: null })
  })
  test('a quote of fewer than three words is never found', () => {
    expect(ground('Mercury is', [PAGE]).found).toBe(false)
  })
  test('no quote, or no material, is not found', () => {
    expect(ground(null, [PAGE]).found).toBe(false)
    expect(ground('Mercury is the only metal', []).found).toBe(false)
  })
})

describe('a typed answer, before any AI is asked', () => {
  test('capitals, punctuation and a leading article do not matter', () => {
    expect(normalizeAnswer('The Mercury!')).toBe(normalizeAnswer('mercury'))
    expect(normalizeAnswer('  DUCTILITY ')).toBe('ductility')
  })
  test('number words are digits, in English and in Filipino', () => {
    expect(normalizeAnswer('five')).toBe('5')
    expect(normalizeAnswer('lima')).toBe('5')
    expect(normalizeAnswer('sampu')).toBe('10')
  })
  test('a decimal keeps its point and a sign its minus', () => {
    expect(normalizeAnswer('-38.8')).toBe('-38.8')
    expect(normalizeAnswer('−38.8 °C')).toBe('-38.8 c')
    expect(normalizeAnswer('38.8')).not.toBe(normalizeAnswer('-38.8'))
    expect(normalizeAnswer('.5')).toBe('.5')
  })
  test('a hyphen between words, or a full stop after one, is not part of the answer', () => {
    expect(normalizeAnswer('well-known')).toBe('well known')
    expect(normalizeAnswer('Brass.')).toBe('brass')
    expect(normalizeAnswer('3-4')).toBe('3-4')
  })
  test('a different word stays different', () => {
    expect(normalizeAnswer('malleability')).not.toBe(normalizeAnswer('ductility'))
  })
})

const question = (prompt: string, answer = 0): QuestionDraft => ({
  kind: 'choice',
  prompt,
  choices: [
    { text: 'A', why: '' },
    { text: 'B', why: '' },
  ],
  answer,
  accepted: [],
  rubric: null,
  points: 1,
  explain: '',
  topic: 'Metals',
  bloom: 'remember',
  page: null,
  quote: null,
})

describe('multiple choice', () => {
  test('the marked option is right and any other is wrong', () => {
    const q = question('Which?', 1)
    expect(gradeChoice(q, 1)).toMatchObject({ correct: true, score: 1, byAi: false })
    expect(gradeChoice(q, 0)).toMatchObject({ correct: false, score: 0, byAi: false })
    expect(gradeChoice(q, null)).toMatchObject({ correct: false, score: 0 })
  })
})

describe('a chat edit keeps each question its row', () => {
  type Saving = QuestionDraft & { id?: number | null }
  const before: Saving[] = [1, 2, 3, 4].map((n) => ({ ...question(`Question ${n}`), id: 100 + n }))
  const run = (ops: Op[]) =>
    applyOps<Saving>(
      before,
      ops,
      (q) => q,
      (old, q) => ({ ...q, id: old.id }),
    )

  test('an updated question keeps its id and takes the new text', () => {
    const after = run([{ op: 'update', number: 2, question: question('Question 2, harder') }])
    expect(after.map((q) => q.id)).toEqual([101, 102, 103, 104])
    expect(after[1]!.prompt).toBe('Question 2, harder')
  })
  test('a removed question goes, and the rest keep theirs', () => {
    expect(run([{ op: 'remove', number: 3 }]).map((q) => q.id)).toEqual([101, 102, 104])
  })
  test('a moved question keeps its id in its new place', () => {
    expect(run([{ op: 'move', number: 4, to: 1 }]).map((q) => q.id)).toEqual([104, 101, 102, 103])
  })
  test('an added question has no id, so it is inserted as a new row', () => {
    const after = run([{ op: 'add', at: 2, question: question('New') }])
    expect(after.map((q) => q.id ?? null)).toEqual([101, null, 102, 103, 104])
  })
  test('numbers refer to the quiz as it was, whatever the order of the operations', () => {
    const after = run([
      { op: 'add', at: 1, question: question('New first') },
      { op: 'remove', number: 1 },
      { op: 'update', number: 4, question: question('Question 4, changed') },
    ])
    expect(after.map((q) => q.id ?? null)).toEqual([null, 102, 103, 104])
    expect(after[3]!.prompt).toBe('Question 4, changed')
  })
})

describe('limits', () => {
  test('the sender is the address Cloudflare reports, never the first forwarded entry', () => {
    const from = (headers: Record<string, string>) => addressOf({ req: { header: (n: string) => headers[n] } })
    expect(from({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '1.2.3.4, 10.0.0.1' })).toBe('203.0.113.9')
    expect(from({ 'x-forwarded-for': '1.2.3.4, 198.51.100.7' })).toBe('198.51.100.7')
    expect(from({})).toBe('local')
  })
  test('a sender gets its count and no more, and the hour moves on', () => {
    const log = new Map<string, number[]>()
    const t = 1_000_000
    expect([1, 2, 3].map(() => within(log, 'a', 3, t))).toEqual([true, true, true])
    expect(within(log, 'a', 3, t + 1)).toBe(false)
    expect(within(log, 'b', 3, t + 1)).toBe(true)
    expect(within(log, 'a', 3, t + 3600_001)).toBe(true)
  })
})
