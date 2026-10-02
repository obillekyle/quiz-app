import { readFile } from 'node:fs/promises'
import DB from 'bakery-orm'
import { PDFDocument } from 'pdf-lib'
import { extractText, getDocumentProxy } from 'unpdf'
import { AiError } from '../ai/gemini.ts'
import { transcribe } from '../ai/transcribe.ts'

/** A page whose text layer holds fewer letters than this is a scan. */
const THIN = 30
/** Scanned pages go to the AI five at a time, two batches at once (Flash Lite allows 15 a minute). */
const BATCH = 5
const PARALLEL = 2

type Read = { pages: string[]; method: 'text' | 'ai' | 'mixed' }

const running = new Map<number, Promise<void>>()

export function startReading(id: number) {
  if (running.has(id)) return
  running.set(
    id,
    read(id).finally(() => running.delete(id)),
  )
}

/** Waits until each of these rows is read (or failed). */
export async function whenRead(ids: number[]) {
  for (const id of ids) {
    const r: any = await DB.from('sources').where('sources.id', id).fetch()
    if (r?.status === 'reading') startReading(id)
  }
  await Promise.all(ids.map((id) => running.get(id)))
}

export const isReading = (id: number) => running.has(id)

async function read(id: number) {
  const row: any = await DB.from('sources').where('sources.id', id).fetch()
  if (!row || row.status !== 'reading') return
  const started = performance.now()
  try {
    const bytes = new Uint8Array(await readFile(String(row.path)))
    const result = row.mime === 'application/pdf' ? await readPdf(id, bytes) : await readPhoto(bytes, String(row.mime))
    await DB.Update.table('sources')
      .set({ status: 'ready', pages: result.pages.length, text: JSON.stringify(result.pages), method: result.method, error: null })
      .where('sources.id', id)
      .run()
    console.log(`read ${row.name}: ${result.pages.length} pages by ${result.method} in ${Math.round(performance.now() - started)} ms`)
  } catch (e) {
    console.error('reading', row.name, e)
    await DB.Update.table('sources').set({ status: 'failed', error: reason(e) }).where('sources.id', id).run()
  }
}

async function readPdf(id: number, bytes: Uint8Array): Promise<Read> {
  let pages: string[]
  try {
    pages = (await extractText(await getDocumentProxy(bytes.slice()), { mergePages: false })).text
  } catch {
    throw new Unreadable('This file could not be opened as a PDF. It may be damaged or protected with a password.')
  }
  const scanned = pages.flatMap((t, i) => (letters(t) < THIN ? [i] : []))
  if (!scanned.length) return { pages, method: 'text' }

  // Tell the prompt box early that the AI is reading, since it takes longer.
  await DB.Update.table('sources').set({ method: scanned.length === pages.length ? 'ai' : 'mixed' }).where('sources.id', id).run()

  const whole = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const batches: number[][] = []
  for (let i = 0; i < scanned.length; i += BATCH) batches.push(scanned.slice(i, i + BATCH))
  await pool(batches, PARALLEL, async (batch) => {
    const part = await PDFDocument.create()
    for (const page of await part.copyPages(whole, batch)) part.addPage(page)
    const data = Buffer.from(await part.save()).toString('base64')
    const r = await transcribe({ inlineData: { mimeType: 'application/pdf', data } }, batch.length, 'pdf')
    batch.forEach((pageIndex, k) => {
      if (r.pages[k]) pages[pageIndex] = r.pages[k]!
    })
  })
  return { pages, method: scanned.length === pages.length ? 'ai' : 'mixed' }
}

async function readPhoto(bytes: Uint8Array, mime: string): Promise<Read> {
  const r = await transcribe({ inlineData: { mimeType: mime, data: Buffer.from(bytes).toString('base64') } }, 1, 'photo')
  if (letters(r.pages[0] ?? '') < 3) throw new Unreadable('No text could be read in this photo. Take it closer and in better light.')
  return { pages: r.pages, method: 'ai' }
}

/** Runs `work` over `items`, at most `n` at a time. */
async function pool<T>(items: T[], n: number, work: (item: T) => Promise<void>) {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) await work(items[next++]!)
    }),
  )
}

const letters = (t: string) => (t.match(/\p{L}/gu) ?? []).length

/** A reason worth showing as it is. */
class Unreadable extends Error {}

function reason(e: unknown) {
  if (e instanceof Unreadable) return e.message
  if (e instanceof AiError) return `The AI could not read this file just now (${e.message}). Remove it and attach it again.`
  return 'This file could not be read. Remove it and attach it again.'
}
