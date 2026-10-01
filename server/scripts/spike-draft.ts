/**
 * Drafts a quiz from a sample module and grounds it, to measure the AI core.
 *   bun scripts/spike-draft.ts ../samples/science7-metals.pdf "request"
 */
import { extractText, getDocumentProxy } from 'unpdf'
import { ground } from '../src/ai/ground.ts'
import { draftQuiz } from '../src/ai/quiz.ts'

const file = process.argv[2] ?? '../samples/science7-metals.pdf'
const request = process.argv[3] ?? '10 questions, mixed kinds, including one essay question.'
const bytes = new Uint8Array(await Bun.file(file).arrayBuffer())
const { text: pages } = await extractText(await getDocumentProxy(bytes.slice()), { mergePages: false })

const { data, ms, model } = await draftQuiz(request, [
  { inlineData: { mimeType: 'application/pdf', data: Buffer.from(bytes).toString('base64') } },
])
const kinds: Record<string, number> = {}
let grounded = 0
for (const q of data.questions) {
  kinds[q.kind] = (kinds[q.kind] ?? 0) + 1
  if (ground(q.quote, pages, q.page).found) grounded++
}
console.log(`${model}: ${ms} ms, ${data.questions.length} questions`, kinds, `grounded ${grounded}/${data.questions.length}`)
console.log(`  title: ${data.title} (${data.language})`)
console.log(`  reply: ${data.reply}`)
for (const q of data.questions) {
  const g = ground(q.quote, pages, q.page)
  console.log(`  - [${q.kind}/${q.bloom}] ${q.prompt}`)
  if (q.kind === 'choice' || q.kind === 'truefalse') console.log(`      answer: ${q.choices[q.answer ?? -1]?.text}`)
  if (q.kind === 'identify') console.log(`      accepted: ${q.accepted.join(' | ')}`)
  if (q.kind === 'essay') console.log(`      rubric: ${q.rubric} (${q.points} pts)`)
  console.log(`      p${q.page} ${g.found ? 'FOUND' : 'NOT FOUND'}: "${q.quote}"`)
}
