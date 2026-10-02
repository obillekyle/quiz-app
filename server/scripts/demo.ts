import { Database } from 'bun:sqlite'
import { unlinkSync } from 'node:fs'

const API = 'http://localhost:3221/api'
const DEMO = 'jose@example.com'
const PASSWORD = 'jose password 1'
const QUIZ = 16

const db = new Database('data/silid.db')
db.run('PRAGMA foreign_keys = ON')
const jose = db.query('select id from users where email = ?').get(DEMO) as { id: number } | null
if (!jose) throw new Error(`no account ${DEMO}: run the seed first`)

// ---- 1. what the test runs left -----------------------------------------------------------
const drop = (paths: { path: string }[]) => {
  for (const { path } of paths) {
    try {
      unlinkSync(path)
    } catch {}
  }
}
db.transaction(() => {
  // Accounts the sign-in tests made (maria and jose are the seeded teachers).
  const testers = db.query("select id from users where email like '%@example.com' and email not in ('maria@example.com', ?)").all(DEMO) as { id: number }[]
  for (const t of testers) {
    drop(db.query('select path from sources where user_id = ? or quiz_id in (select id from quizzes where user_id = ?)').all(t.id, t.id) as any)
    db.query('delete from users where id = ?').run(t.id)
  }
  // Jose's other quizzes (placeholders and test drafts) and any upload left in a prompt box.
  const others = db.query('select id from quizzes where user_id = ? and id != ?').all(jose.id, QUIZ) as { id: number }[]
  for (const q of others) {
    drop(db.query('select path from sources where quiz_id = ?').all(q.id) as any)
    db.query('delete from quizzes where id = ?').run(q.id)
  }
  drop(db.query('select path from sources where user_id = ? and quiz_id is null').all(jose.id) as any)
  db.query('delete from sources where user_id = ? and quiz_id is null').run(jose.id)
  // Quiz 16 starts over: no responses, no reports, no views, no test edit in its first question.
  db.query('delete from responses where quiz_id = ?').run(QUIZ)
  db.query('delete from reports where quiz_id = ?').run(QUIZ)
  db.query('update quizzes set views = 0, insight = null, insight_at = null where id = ?').run(QUIZ)
  db.query("update questions set prompt = replace(prompt, ' (edited)', '') where quiz_id = ?").run(QUIZ)
  db.query('update users set notices_seen_at = null where id = ?').run(jose.id)
})()
console.log('cleared the test runs')

// ---- 2. a class answers -----------------------------------------------------------------------
const code = (db.query('select share_code c from quizzes where id = ?').get(QUIZ) as { c: string }).c
const questions = db.query('select id, kind, answer, choices from questions where quiz_id = ? order by position').all(QUIZ) as {
  id: number
  kind: string
  answer: number | null
  choices: string
}[]

const HARD = [0.05, 0.2, 0.5, 0.25, 0.4, 0.15, 0.3, 0.2, 0.45, 0, 0.1]
const ESSAYS = [
  'Mercury is toxic. Its vapor can damage the brain and kidneys, so a broken thermometer must never be cleaned with bare hands or a vacuum cleaner. Open the windows, keep people away, wear gloves, and collect the beads with stiff paper into a sealed container for proper disposal.',
  'Mercury is poisonous and can harm the body when it is breathed in. If a thermometer breaks it should not be touched with the hands, and it has to be cleaned carefully.',
  'Because the glass can break and cut someone.',
]
const IDENTIFY_RIGHT = ['ductility', 'Ductile', 'DUCTILITY']
const IDENTIFY_WRONG = ['malleability', 'conductivity']
const CLASS = [
  { name: 'Ana Reyes', skill: 0.85, essay: 0, rating: 5 },
  { name: 'Ben Cruz', skill: 0.95, essay: 0, rating: 5 },
  { name: 'Carla Santos', skill: 0.7, essay: 1, rating: 4 },
  { name: 'Diego Mendoza', skill: 0.55, essay: 2, rating: 3 },
  { name: 'Elisa Navarro', skill: 0.8, essay: 1, rating: 4 },
  { name: 'Franco Dela Cruz', skill: 0.6, essay: 2, rating: 4 },
  { name: 'Gia Villanueva', skill: 0.9, essay: 0, rating: 5 },
  { name: 'Hans Ramos', skill: 0.5, essay: 1, rating: 3, skips: 1 },
  { name: 'Isabel Garcia', skill: 0.75, essay: 1, rating: 4 },
  { name: 'Jomar Aquino', skill: 0.65, essay: 2, rating: 4 },
  { name: 'Kristine Lim', skill: 0.88, essay: 0, rating: 5 },
  { name: 'Luis Bautista', skill: 0.45, essay: 2, rating: 3, skips: 2 },
]

// A fixed seed, so a rerun makes the same class.
let seed = 20261002
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}

async function post(path: string, body: unknown, token?: string) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-attempt-token': token } : {}) },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`)
  return res.json() as Promise<any>
}

async function answerAll(person: (typeof CLASS)[number] & { skips?: number }, upTo = questions.length) {
  const { attempt, token } = await post(`/q/${code}/attempts`, { name: person.name, view: true })
  let skipped = 0
  for (const [i, q] of questions.slice(0, upTo).entries()) {
    if (person.skips && skipped < person.skips && i >= questions.length - 3 && q.kind !== 'essay') {
      skipped++
      continue
    }
    const right = rand() < person.skill * (1 - HARD[i]!)
    let given: { choice?: number; text?: string }
    if (q.kind === 'choice' || q.kind === 'truefalse') {
      const n = (JSON.parse(q.choices) as unknown[]).length
      const wrong = [...Array(n).keys()].filter((k) => k !== q.answer)
      given = { choice: right ? q.answer! : wrong[Math.floor(rand() * wrong.length)]! }
    } else if (q.kind === 'identify') {
      const pool = right ? IDENTIFY_RIGHT : IDENTIFY_WRONG
      given = { text: pool[Math.floor(rand() * pool.length)]! }
    } else {
      given = { text: ESSAYS[person.essay]! }
    }
    await post(`/attempts/${attempt}/answers`, { questionId: q.id, ...given }, token)
  }
  return { attempt, token }
}

const started = performance.now()
for (const person of CLASS) {
  const { attempt, token } = await answerAll(person)
  const r = await post(`/attempts/${attempt}/finish`, { rating: person.rating }, token)
  console.log(`${person.name}: ${r.score} / ${r.total}`)
}
// One who is still answering.
await answerAll({ name: 'Mika Torres', skill: 0.8, essay: 0, rating: 0 }, 4)
console.log(`class answered in ${((performance.now() - started) / 1000).toFixed(0)} s`)

// ---- 3. a week and a half of it, for the chart ---------------------------------------------------
const DAYS = [0, 0, 1, 1, 2, 3, 4, 4, 6, 7, 8, 9]
const now = Math.floor(Date.now() / 1000)
const finished = db.query("select id from responses where quiz_id = ? and status = 'finished' order by id").all(QUIZ) as { id: number }[]
db.transaction(() => {
  finished.forEach((r, i) => {
    const at = now - DAYS[i % DAYS.length]! * 86400 - Math.floor(rand() * 6 * 3600)
    db.query('update responses set finished_at = ? where id = ?').run(at, r.id)
  })
  // People who opened the link and did not answer count as views too.
  db.query('update quizzes set views = views + 5 where id = ?').run(QUIZ)
})()
console.log(`spread ${finished.length} finishes over ${Math.max(...DAYS) + 1} days`)

// ---- 4. a draft in Filipino, from the sample module ---------------------------------------------
const login = await fetch(API + '/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: DEMO, password: PASSWORD }),
})
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!
const form = new FormData()
form.append('file', new File([await Bun.file('../samples/filipino7-pang-uri.pdf').arrayBuffer()], 'filipino7-pang-uri.pdf', { type: 'application/pdf' }))
const upload = (await (await fetch(API + '/uploads', { method: 'POST', headers: { cookie }, body: form })).json()) as { id: number }
const made = (await (
  await fetch(API + '/quizzes', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: 'Sampung tanong tungkol sa pang-uri at sa mga kaantasan nito. Halo-halong uri ng tanong, may isang sanaysay.',
      sources: [upload.id],
    }),
  })
).json()) as { id: number }
const draft = (await (await fetch(`${API}/quizzes/${made.id}/draft`, { method: 'POST', headers: { cookie } })).json()) as any
console.log(`drafted quiz ${made.id}: ${draft.quiz?.title}, ${draft.questions?.length} questions, ${draft.questions?.filter((q: any) => q.check === 'found').length} quotes found`)
