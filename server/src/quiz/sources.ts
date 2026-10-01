import { mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import DB from 'bakery-orm'
import { HTTPException } from 'hono/http-exception'
import type { Part } from '../ai/gemini.ts'

const DIR = join(process.cwd(), 'data', 'uploads')

const TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
}
/**
 * A PDF is read from its text layer, or sent to the AI five scanned pages at
 * a time, so its size matters little. A photo goes to the AI whole, and a
 * request to it carries 20 MB at most once encoded.
 */
const MAX_PDF = 25 * 1024 * 1024
const MAX_PHOTO = 10 * 1024 * 1024
/** Uploads left in the prompt box this long without being sent are dropped. */
const STALE = 24 * 3600

export type Source = {
  id: number
  name: string
  mime: string
  size: number
  path: string
  /** Each page's text, once read. */
  pages: string[] | null
  status: 'reading' | 'ready' | 'failed'
  /** How it was read: its text layer, the AI's transcription, or both. */
  method: 'text' | 'ai' | 'mixed' | null
  error: string | null
}

const bad = (message: string) => new HTTPException(400, { message })

export function checkFile(f: File) {
  if (!TYPES[f.type]) throw bad(`${f.name} is not a PDF or a photo. Attach PDFs, or photos (JPG, PNG, WebP, HEIC).`)
  if (f.size === 0) throw bad(`${f.name} is empty.`)
  if (f.type === 'application/pdf' && f.size > MAX_PDF) throw bad(`${f.name} is larger than 25 MB. Attach a smaller file, or split it.`)
  if (f.type !== 'application/pdf' && f.size > MAX_PHOTO) throw bad(`${f.name} is larger than 10 MB. Attach a smaller photo.`)
}

export function toSource(r: any): Source {
  return {
    id: Number(r.id),
    name: String(r.name),
    mime: String(r.mime),
    size: Number(r.size),
    path: String(r.path),
    pages: r.text ? (JSON.parse(String(r.text)) as string[]) : null,
    status: r.status ?? 'ready',
    method: r.method ?? null,
    error: r.error ?? null,
  }
}

/** Saves a file from the prompt box under its owner, in no quiz yet. The caller starts reading it. */
export async function saveUpload(userId: number, f: File): Promise<Source> {
  checkFile(f)
  await dropStale(userId)
  const dir = join(DIR, `u${userId}`)
  await mkdir(dir, { recursive: true })
  const safe = f.name.replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(-120) || `file.${TYPES[f.type]}`
  const path = join(dir, `${Date.now()}-${safe}`)
  await writeFile(path, new Uint8Array(await f.arrayBuffer()))
  const r = await DB.Insert.into('sources')
    .values({
      userId,
      name: f.name.slice(0, 255),
      mime: f.type,
      size: f.size,
      path,
      status: 'reading',
      method: f.type === 'application/pdf' ? null : 'ai',
    })
    .run()
  return toSource(await DB.from('sources').where('sources.id', Number(r.lastInsertRowid)).fetch())
}

/** An upload of this user's that waits in a prompt box (in no quiz yet), or a 404. */
export async function ownUpload(id: number, userId: number) {
  const row: any = Number.isFinite(id) ? await DB.from('sources').where('sources.id', id).fetch() : null
  if (!row || Number(row.userId) !== userId) throw new HTTPException(404, { message: 'This file does not exist.' })
  return row
}

/** Moves a user's waiting uploads into a quiz, in the order given. */
export async function attachSources(quizId: number, userId: number, ids: unknown): Promise<Source[]> {
  const list = Array.isArray(ids) ? [...new Set(ids.map(Number).filter(Number.isInteger))] : []
  const out: Source[] = []
  for (const id of list) {
    const row: any = await DB.from('sources').where('sources.id', id).fetch()
    if (!row || Number(row.userId) !== userId || row.quizId != null)
      throw bad('An attached file is no longer available. Attach it again.')
    await DB.Update.table('sources').set({ quizId }).where('sources.id', id).run()
    out.push(toSource(row))
  }
  return out
}

export async function loadSources(quizId: number): Promise<Source[]> {
  const rows = await DB.from('sources').where('sources.quizId', quizId).orderBy('sources.id').array()
  return rows.map(toSource)
}

const hasText = (s: Source) => s.status === 'ready' && !!s.pages?.some((t) => t.trim())

/** Every page of the material that has text, in order, with the file it came from. */
export function allPages(sources: Source[]) {
  return sources.flatMap((s) => (hasText(s) ? s.pages! : []).map((text, i) => ({ source: s, page: i + 1, text })))
}

/**
 * The material as the AI takes it: each file's stored pages, as text. A file
 * read before transcription existed and holding no text (an early photo, or
 * a scan) goes inline instead, as it always did. A file that failed to read
 * is left out; the prompt box showed why before it was sent.
 */
export async function materialParts(sources: Source[]): Promise<Part[]> {
  const parts: Part[] = []
  for (const s of sources) {
    if (hasText(s)) parts.push({ text: `Material "${s.name}":\n${s.pages!.map((t, i) => `[Page ${i + 1}]\n${t}`).join('\n\n')}` })
    else if (s.status === 'ready') {
      if (sources.length > 1) parts.push({ text: `File: ${s.name}` })
      parts.push({ inlineData: { mimeType: s.mime, data: (await readFile(s.path)).toString('base64') } })
    }
  }
  return parts
}

/** Deletes these files from disk (their rows go with their quiz), and a quiz's old upload folder. */
export async function removeFiles(sources: Source[], quizId?: number) {
  for (const s of sources) await unlink(s.path).catch(() => {})
  if (quizId) await rm(join(DIR, String(quizId)), { recursive: true, force: true })
}

/** A user's uploads that waited a day in a prompt box and were never sent. */
async function dropStale(userId: number) {
  const cutoff = Math.floor(Date.now() / 1000) - STALE
  const rows = await DB.from('sources').where('sources.userId', userId).and('sources.quizId', null).array()
  for (const r of rows as any[]) {
    const created = typeof r.createdAt === 'number' ? r.createdAt : Math.floor(new Date(String(r.createdAt)).getTime() / 1000)
    if (created && created < cutoff) {
      await unlink(String(r.path)).catch(() => {})
      await DB.Delete.from('sources').where('sources.id', r.id).run()
    }
  }
}
