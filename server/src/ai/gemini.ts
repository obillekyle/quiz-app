/**
 * Gemini (and Gemma) over plain REST: `fetch` works the same on Bun and
 * Node, and the whole client is this file.
 *
 * Every call asks for JSON that matches a schema ("structured output"), so
 * the reply is parsed rather than scraped out of prose.
 */

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

/** What a call is for; each job has its own chain of models. */
export type Task = 'draft' | 'edit' | 'check' | 'essay' | 'insight' | 'read' | 'illustrate'

/**
 * The free tier sets the chains (AI Studio's limits for this key, 2026-10-01):
 * every full Flash model allows 20 requests a day and 5 a minute; the Flash
 * Lite models 500 a day and 15 a minute; Gemma 4 14,400 a day and 30 a minute
 * but 16K tokens a minute. So the full models write drafts, where quality
 * shows, and everything frequent runs on Lite or Gemma.
 *
 * Measured the same evening:
 * - draft of 10 questions from the 3-page science module: 17.4 s on 3.6
 *   Flash, 18.3 s on 3-flash-preview, 10 of 10 quotes grounded on both.
 * - checking one typed answer ("merkury", "galium", "ductile ness"): Gemma 4
 *   26B 1.7 to 3.6 s, 3.1 Flash Lite 1.9 to 3.6 s, 3.5 Flash Lite 7 to 14 s;
 *   all three right on all three cases. Gemma 4 31B answered 503 and 500.
 * - the same small request: 1.6 s on 3.6 Flash, 40 s on 3.7, 97 s on
 *   flash-latest, 503 on 3.8: demand on one model swings, so each chain
 *   moves on to the next model rather than waiting.
 */
const CHAINS: Record<Task, string[]> = {
  draft: [
    'gemini-3.6-flash',
    'gemini-3-flash-preview',
    'gemini-3.8-flash',
    'gemini-3.5-flash',
    'gemini-3.7-flash',
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash-lite',
  ],
  edit: ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3-flash-preview'],
  check: ['gemma-4-26b-a4b-it', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'],
  essay: ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemma-4-26b-a4b-it'],
  insight: ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemma-4-26b-a4b-it'],
  // Transcribing photos and scanned pages, once per file: Flash Lite reads
  // print well and has 500 a day; a full Flash only when both Lites rest.
  read: ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3-flash-preview'],
  // Finding a figure on a page and naming a picture to search for: one call
  // per question asked about, on the same models as reading.
  illustrate: ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3-flash-preview'],
}

/** A part of a message: text, or a file sent inline (PDF or image, base64). */
export type Part = { text: string } | { inlineData: { mimeType: string; data: string } }

/** A failure the app can show to a person as it is. */
export class AiError extends Error {
  status: number
  constructor(message: string, status = 502) {
    super(message)
    this.status = status
  }
}

type Options = {
  task: Task
  system: string
  parts: Part[]
  schema: object
  temperature?: number
  /** Milliseconds before giving up on one attempt. */
  timeout?: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Models that just refused, with when they may lead a chain again: two
 * minutes after "overloaded" (503) or a per-minute limit, and until the
 * daily reset (midnight Pacific, 07:00 UTC in October) after the day's
 * quota is spent. Without this, every request spent its first seconds on the
 * same refusing model (a 21 s draft against 17 s on the fallback alone).
 */
const resting = new Map<string, number>()
const nextPacificMidnight = () => {
  const d = new Date()
  d.setUTCHours(7, 0, 0, 0)
  if (d.getTime() <= Date.now()) d.setUTCDate(d.getUTCDate() + 1)
  return d.getTime()
}

/** Thinking: the full Gemini 3 models take a level; Lite and Gemma get none. */
function thinking(model: string) {
  if (model.startsWith('gemini-2.5') && !model.includes('lite')) return { thinkingBudget: 0 }
  if (model.startsWith('gemini-3') && !model.includes('lite')) return { thinkingLevel: 'low' }
  return undefined
}

/**
 * One structured call, tried down the task's chain (resting models last, at
 * most four attempts). Anything but overload, a rate limit, a timeout or an
 * unusable reply fails at once, with a message for the person waiting on it.
 */
export async function generate<T>(o: Options): Promise<{ data: T; ms: number; model: string }> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new AiError('The AI is not set up on this server (GEMINI_API_KEY is missing).', 503)

  const now = Date.now()
  const all = CHAINS[o.task]
  const chain = [...all.filter((m) => (resting.get(m) ?? 0) <= now), ...all.filter((m) => (resting.get(m) ?? 0) > now)].slice(0, 4)

  const started = performance.now()
  let last = ''
  for (const [i, model] of chain.entries()) {
    if (i) await sleep(500)
    const think = thinking(model)
    let res: Response
    try {
      res = await fetch(`${BASE}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: o.system }] },
          contents: [{ role: 'user', parts: o.parts }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: o.schema,
            temperature: o.temperature ?? 0.4,
            ...(think ? { thinkingConfig: think } : {}),
          },
        }),
        signal: AbortSignal.timeout(o.timeout ?? 60_000),
      })
    } catch (e) {
      last = e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'network'
      console.error(`gemini: ${model} ${last}`)
      continue
    }
    if (res.status === 429 || res.status >= 500) {
      const body = await res.text().catch(() => '')
      last = String(res.status)
      const daily = res.status === 429 && body.includes('PerDay')
      if (res.status === 429 || res.status === 503) resting.set(model, daily ? nextPacificMidnight() : Date.now() + 2 * 60_000)
      console.error(`gemini: ${model} answered ${res.status}${daily ? ' (daily quota spent)' : ''}, trying the next model`)
      continue
    }
    const json: any = await res.json().catch(() => null)
    if (!res.ok) {
      const msg = json?.error?.message ?? `HTTP ${res.status}`
      console.error('gemini:', model, res.status, msg)
      // A model this key may not use (404) is skipped like a refusing one.
      if (res.status === 404) {
        last = '404'
        resting.set(model, nextPacificMidnight())
        continue
      }
      if (res.status === 400)
        throw new AiError('The AI could not read this request. Try a smaller file or a shorter prompt.', 502)
      throw new AiError('The AI service refused the request. The server’s AI settings need checking.', 502)
    }
    const candidate = json?.candidates?.[0]
    if (candidate?.finishReason === 'SAFETY' || json?.promptFeedback?.blockReason)
      throw new AiError('The AI declined this material. Try different material or wording.', 422)
    const text: string = (candidate?.content?.parts ?? []).map((p: any) => p.text ?? '').join('')
    try {
      return { data: decodeDeep(JSON.parse(text)) as T, ms: Math.round(performance.now() - started), model }
    } catch {
      last = 'unparseable reply'
      console.error(`gemini: ${model} reply was not JSON:`, text.slice(0, 200))
      continue
    }
  }
  console.error(`gemini: ${o.task} gave up after`, chain.join(', '), 'last:', last)
  if (last === '429') throw new AiError('The AI is busy right now (rate limit). Wait a minute and try again.', 429)
  if (last === 'timeout') throw new AiError('The AI took too long to answer. Try again, or try a smaller file.', 504)
  throw new AiError('The AI could not be reached. Try again in a moment.', 502)
}

/** Gemini's schema vocabulary, spelled once. */
/**
 * The models now and then write HTML entities into their JSON ("29.8 &deg;C",
 * "&#8211;"), which a page would show as they are. Every string of an answer
 * is decoded once, here, so a quiz stores the characters themselves.
 */
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', deg: '\u00b0', plusmn: '\u00b1',
  times: '\u00d7', divide: '\u00f7', micro: '\u00b5', middot: '\u00b7', ndash: '\u2013', mdash: '\u2014',
  hellip: '\u2026', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d', laquo: '\u00ab',
  raquo: '\u00bb', le: '\u2264', ge: '\u2265', ne: '\u2260', minus: '\u2212', frac12: '\u00bd',
  frac14: '\u00bc', frac34: '\u00be', sup2: '\u00b2', sup3: '\u00b3', ntilde: '\u00f1', Ntilde: '\u00d1',
  eacute: '\u00e9', aacute: '\u00e1', iacute: '\u00ed', oacute: '\u00f3', uacute: '\u00fa', deg2: '\u00b0',
}
export function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[name] ?? whole
  })
}
function decodeDeep(v: unknown): unknown {
  if (typeof v === 'string') return decodeEntities(v)
  if (Array.isArray(v)) return v.map(decodeDeep)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decodeDeep(x)]))
  return v
}

export const S = {
  str: (description?: string) => ({ type: 'STRING', ...(description ? { description } : {}) }),
  int: (description?: string) => ({ type: 'INTEGER', ...(description ? { description } : {}) }),
  num: (description?: string) => ({ type: 'NUMBER', ...(description ? { description } : {}) }),
  bool: (description?: string) => ({ type: 'BOOLEAN', ...(description ? { description } : {}) }),
  enum: (values: readonly string[], description?: string) => ({
    type: 'STRING',
    enum: [...values],
    ...(description ? { description } : {}),
  }),
  arr: (items: object, description?: string) => ({ type: 'ARRAY', items, ...(description ? { description } : {}) }),
  obj: (properties: Record<string, object>, required: string[] = Object.keys(properties)) => ({
    type: 'OBJECT',
    properties,
    required,
    propertyOrdering: Object.keys(properties),
  }),
  nullable: <T extends object>(s: T) => ({ ...s, nullable: true }),
}
