import DB, { initDB } from 'bakery-orm'
import { ground } from '../src/ai/ground.ts'
import { startReading, whenRead } from '../src/quiz/read.ts'
import { allPages, loadSources } from '../src/quiz/sources.ts'

await initDB()
const quizId = Number(process.argv[2])
if (!Number.isInteger(quizId)) throw new Error('usage: bun scripts/reread.ts <quizId>')

const before = await loadSources(quizId)
if (!before.length) throw new Error(`quiz ${quizId} has no files`)
for (const s of before) {
  console.log(`reading ${s.name} (${s.pages?.length ?? 0} pages stored, ${s.pages?.filter((t) => t.trim()).length ?? 0} with text)`)
  await DB.Update.table('sources').set({ status: 'reading', text: null, method: null, error: null }).where('sources.id', s.id).run()
  startReading(s.id)
}
const started = performance.now()
await whenRead(before.map((s) => s.id))
const sources = await loadSources(quizId)
for (const s of sources) console.log(`  ${s.name}: ${s.status}, ${s.method}, ${s.pages?.filter((t) => t.trim()).length ?? 0} of ${s.pages?.length ?? 0} pages with text${s.error ? `, ${s.error}` : ''} (${Math.round((performance.now() - started) / 1000)} s)`)

const pages = allPages(sources)
const texts = pages.map((p) => p.text)
const questions = (await DB.from('questions').where('questions.quizId', quizId).orderBy('questions.position').array()) as any[]
let found = 0
for (const q of questions) {
  const g = ground(q.sourceQuote, texts, null)
  const where = g.found && g.page ? pages[g.page - 1] : null
  if (g.found) found++
  await DB.Update.table('questions')
    .set({ grounded: g.found, sourcePage: where ? where.page : q.sourcePage, sourceFile: where ? where.source.name.slice(0, 255) : null })
    .where('questions.id', q.id)
    .run()
}
console.log(`quotes found: ${found} of ${questions.length}`)
