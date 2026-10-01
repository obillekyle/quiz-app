/**
 * Sample quizzes for one account, so the home screen has something to show
 * and the demo has educational data in it.
 *
 *   bun scripts/seed.ts someone@example.com
 *
 * Adds six quizzes with their questions to that account; running it again
 * adds nothing for a title the account already has.
 */
import { randomBytes } from 'node:crypto'
import DB, { closeDB, initDB } from 'bakery-orm'

type Q = { prompt: string; choices: [string, string][]; answer: number; topic: string; bloom: string; page: number; quote: string }

const SAMPLES: { title: string; language: 'en' | 'fil'; source: string; pages: number; daysAgo: number; questions: Q[] }[] = [
  {
    title: 'Properties of Metals',
    language: 'en',
    source: 'Science 7 Module 3.pdf',
    pages: 18,
    daysAgo: 0,
    questions: [
      {
        prompt: 'What is the only metal that is liquid at room temperature?',
        choices: [
          ['Gallium', 'Gallium melts in the hand but is solid at room temperature.'],
          ['Mercury', 'Mercury melts at about -38.8 °C, so it is liquid at room temperature.'],
          ['Cesium', 'Cesium melts at about 28.5 °C, just above room temperature.'],
          ['Bromine', 'Bromine is liquid at room temperature, but it is not a metal.'],
        ],
        answer: 1,
        topic: 'States of matter',
        bloom: 'remember',
        page: 3,
        quote: 'Mercury is the only metal that is liquid at room temperature.',
      },
      {
        prompt: 'Why are metals good conductors of electricity?',
        choices: [
          ['Their electrons move freely between atoms.', 'Free electrons carry the current through the metal.'],
          ['They are heavy.', 'Mass has nothing to do with conducting a current.'],
          ['They are shiny.', 'Luster and conductivity come from the same electrons, but shine does not cause it.'],
          ['They melt easily.', 'Most metals have high melting points.'],
        ],
        answer: 0,
        topic: 'Conductivity',
        bloom: 'understand',
        page: 5,
        quote: 'The electrons in a metal are free to move, which lets a current flow through it.',
      },
    ],
  },
  { title: 'Science Trivia Quiz', language: 'en', source: 'General science notes.pdf', pages: 9, daysAgo: 1, questions: [] },
  { title: 'Elements of Art', language: 'en', source: 'AAP Lesson 2.pdf', pages: 12, daysAgo: 3, questions: [] },
  { title: 'Basic Computer Hardware', language: 'en', source: 'MST 223 Hardware and Software Basics.pdf', pages: 24, daysAgo: 6, questions: [] },
  { title: 'Panitikan: Mga Akdang Pampanitikan', language: 'fil', source: 'FIL 223 Aralin 1.pdf', pages: 15, daysAgo: 9, questions: [] },
  { title: 'Philippine Revolution', language: 'en', source: 'AP 6 Module 2.pdf', pages: 20, daysAgo: 14, questions: [] },
]

const email = process.argv[2]?.trim().toLowerCase()
if (!email) {
  console.error('Usage: bun scripts/seed.ts <email of the account>')
  process.exit(1)
}

await initDB()
const user = await DB.from('users').where('users.email', email).fetch()
if (!user) {
  console.error(`No account with the email ${email}. Sign in once first, then run this again.`)
  process.exit(1)
}

const now = Math.floor(Date.now() / 1000)
let added = 0
for (const s of SAMPLES) {
  const exists = await DB.from('quizzes').where('quizzes.userId', user.id).and('quizzes.title', s.title).exists()
  if (exists) continue
  const at = now - s.daysAgo * 86400 - 3600
  const quiz = await DB.Insert.into('quizzes')
    .values({
      userId: user.id,
      title: s.title,
      shareCode: randomBytes(6).toString('base64url').slice(0, 8),
      language: s.language,
      sourceName: s.source,
      sourcePages: s.pages,
      createdAt: at,
      updatedAt: at,
    })
    .run()
  const quizId = Number(quiz.lastInsertRowid)
  for (const [i, q] of s.questions.entries()) {
    await DB.Insert.into('questions')
      .values({
        quizId,
        position: i,
        kind: 'choice',
        prompt: q.prompt,
        choices: JSON.stringify(q.choices.map(([text, why]) => ({ text, why }))),
        answer: q.answer,
        topic: q.topic,
        bloom: q.bloom,
        sourcePage: q.page,
        sourceQuote: q.quote,
        grounded: true,
      })
      .run()
  }
  added++
}
console.log(`Added ${added} sample quizzes to ${email}.`)
await closeDB()
