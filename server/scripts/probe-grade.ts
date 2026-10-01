export {}
/**
 * Which model should check a typed answer? One near-miss grading call per
 * model, with a system instruction and a JSON schema, timed.
 *   bun scripts/probe-grade.ts
 */
const key = process.env.GEMINI_API_KEY!
const system =
  'You check a typed quiz answer against the accepted answers. Count it correct if it means the same thing: ignore capitalization, spacing and small spelling slips, and accept numbers written as words. Do not accept a different thing.'
const cases = [
  { answer: 'merkury', accepted: ['Mercury'], expect: true },
  { answer: 'galium', accepted: ['Mercury'], expect: false },
  { answer: 'ductile ness', accepted: ['Ductility'], expect: true },
]
const schema = { type: 'OBJECT', properties: { correct: { type: 'BOOLEAN' }, reason: { type: 'STRING' } }, required: ['correct', 'reason'] }

for (const model of ['gemma-4-26b-a4b-it', 'gemma-4-31b-it', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']) {
  for (const c of cases) {
    const t = performance.now()
    const body: any = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: `Question: What is the only metal that is liquid at room temperature? / What property lets metals be drawn into wires?\nAccepted: ${JSON.stringify(c.accepted)}\nAnswer given: "${c.answer}"` }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0 },
    }
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    })
    const j: any = await r.json().catch(() => ({}))
    const text = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? ''
    let verdict = ''
    try {
      const v = JSON.parse(text)
      verdict = `${v.correct === c.expect ? 'RIGHT' : 'WRONG'} correct=${v.correct} "${String(v.reason).slice(0, 60)}"`
    } catch {
      verdict = r.ok ? `unparsed: ${text.slice(0, 80)}` : `${r.status} ${(j.error?.message ?? '').slice(0, 90)}`
    }
    console.log(model.padEnd(24), c.answer.padEnd(13), `${Math.round(performance.now() - t)} ms`.padStart(8), verdict)
  }
}
