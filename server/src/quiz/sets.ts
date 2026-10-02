import type { ItemSet, QuestionDraft } from '../ai/quiz.ts'
import { layout, letters, type Entry } from './crossword.ts'
import { normalizeAnswer, type Graded } from './grade.ts'

type Member = QuestionDraft & { id: number }
export type Placed = Omit<Entry, 'index'>
export type ShownSet = { key: string; style: ItemSet['style']; title: string; words: string[]; rows: number; cols: number }

export function setsOf(questions: Member[]) {
  const groups = new Map<string, { set: ItemSet; members: Member[] }>()
  for (const q of questions) {
    if (q.kind !== 'identify' || !q.itemSet) continue
    const g = groups.get(q.itemSet.key)
    if (g) g.members.push(q)
    else groups.set(q.itemSet.key, { set: q.itemSet, members: [q] })
  }
  const sets: ShownSet[] = []
  const entries = new Map<number, Placed>()
  const member = new Map<number, string>()
  for (const { set, members } of groups.values()) {
    const first = members.map((m) => m.accepted[0] ?? '')
    if (set.style === 'bank') {
      // Alphabetical, so the order says nothing about which word goes where.
      const seen = new Set<string>()
      const words = [...first, ...set.extra]
        .map((w) => w.trim())
        .filter((w) => {
          const k = normalizeAnswer(w)
          return k && !seen.has(k) && !!seen.add(k)
        })
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      sets.push({ key: set.key, style: 'bank', title: set.title, words, rows: 0, cols: 0 })
      for (const m of members) member.set(m.id, set.key)
    } else {
      const grid = layout(first)
      for (const { index, ...placed } of grid.entries) {
        entries.set(members[index]!.id, placed)
        member.set(members[index]!.id, set.key)
      }
      // A word the grid has no crossing for stays an ordinary typed question.
      if (grid.entries.length) sets.push({ key: set.key, style: 'crossword', title: set.title, words: [], rows: grid.rows, cols: grid.cols })
    }
  }
  return { sets, entries, member }
}

export function gradeInSet(q: QuestionDraft, style: ItemSet['style'], text: string): Graded {
  const fold = style === 'crossword' ? letters : normalizeAnswer
  const given = fold(text)
  if (!given) return { correct: false, score: 0, verdict: 'No answer was given.', byAi: false }
  if (q.accepted.some((a) => fold(a) === given)) return { correct: true, score: q.points, verdict: null, byAi: false }
  return {
    correct: false,
    score: 0,
    verdict: style === 'bank' ? 'A different word from the bank fits here.' : 'These letters do not spell the answer.',
    byAi: false,
  }
}
