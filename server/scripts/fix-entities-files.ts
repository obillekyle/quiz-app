/**
 * One-off repair, 2026-10-01: text the AI wrote before answers were decoded
 * kept HTML entities ("29.8 &deg;C"), and questions saved before
 * `sourceFile` existed do not name the file their quote is in. Decodes the
 * stored strings (inside JSON columns too, parsed rather than patched) and
 * finds each grounded quote's file again. Safe to run twice.
 *
 *   bun scripts/fix-entities-files.ts
 */
import { Database } from 'bun:sqlite'
import { decodeEntities } from '../src/ai/gemini.ts'
import { ground } from '../src/ai/ground.ts'

const db = new Database('data/silid.db')
const fix = (s: unknown) => (typeof s === 'string' ? decodeEntities(s) : s)
const fixJson = (s: unknown) => {
  if (typeof s !== 'string') return s
  const walk = (v: unknown): unknown =>
    typeof v === 'string' ? decodeEntities(v) : Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v
  try {
    return JSON.stringify(walk(JSON.parse(s)))
  } catch {
    return s
  }
}

let changed = 0
db.transaction(() => {
  for (const q of db.query('select id, prompt, choices, accepted, rubric, explain, topic, source_quote from questions').all() as any[]) {
    const next = [fix(q.prompt), fixJson(q.choices), fixJson(q.accepted), fix(q.rubric), fix(q.explain), fix(q.topic), fix(q.source_quote)]
    const before = [q.prompt, q.choices, q.accepted, q.rubric, q.explain, q.topic, q.source_quote]
    if (next.some((v, i) => v !== before[i])) {
      db.query('update questions set prompt = ?, choices = ?, accepted = ?, rubric = ?, explain = ?, topic = ?, source_quote = ? where id = ?').run(...(next as any[]), q.id)
      changed++
    }
  }
  for (const m of db.query("select id, text from messages where text like '%&%;%'").all() as any[]) {
    db.query('update messages set text = ? where id = ?').run(fix(m.text) as string, m.id)
    changed++
  }
  for (const z of db.query("select id, title, insight from quizzes where title like '%&%;%' or insight like '%&%;%'").all() as any[]) {
    db.query('update quizzes set title = ?, insight = ? where id = ?').run(fix(z.title) as string, fix(z.insight) as string | null, z.id)
    changed++
  }
})()
console.log('rows decoded:', changed)

// The file each grounded quote was found in, from the stored pages.
let filed = 0
const quizzes = db.query('select distinct quiz_id from questions where grounded = 1 and source_file is null').all() as any[]
for (const { quiz_id } of quizzes) {
  const sources = db.query("select name, text from sources where quiz_id = ? and status = 'ready' order by id").all(quiz_id) as any[]
  const pages = sources.flatMap((s) => (s.text ? (JSON.parse(s.text) as string[]) : []).map((t) => ({ name: s.name as string, text: t })))
  if (!pages.length) continue
  for (const q of db.query('select id, source_quote from questions where quiz_id = ? and grounded = 1 and source_file is null').all(quiz_id) as any[]) {
    const g = ground(q.source_quote, pages.map((p) => p.text), null)
    if (g.found && g.page) {
      db.query('update questions set source_file = ? where id = ?').run(pages[g.page - 1]!.name.slice(0, 255), q.id)
      filed++
    }
  }
}
console.log('questions given their file:', filed)
