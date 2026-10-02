import { randomBytes } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { HTTPException } from 'hono/http-exception'
import { generate, S, type Part } from '../ai/gemini.ts'
import type { Source } from './sources.ts'

const DIR = join(process.cwd(), 'data', 'illustrations')
export const NAME = /^[a-f0-9]{24}\.(jpg|png|webp)$/
const MAX_BYTES = 5 * 1024 * 1024
// Wikimedia asks every client to name itself and give a way to reach its maker.
const UA = 'QuizApp/0.1 (https://okyle.dev; RAITE 2026 hackathon)'

export type Credit = { from: 'upload' | 'module' | 'wikimedia'; text: string; url: string | null }
export type Illustration = { image: string; imageAlt: string; imageCredit: Credit | null }
export type Candidate = {
  kind: 'module' | 'wikimedia'
  /** What the builder shows while choosing: our own file, or Commons' thumbnail. */
  preview: string
  alt: string
  credit: Credit
  /** A module crop's saved name, or a Commons thumbnail's address. */
  ref: string
}

/** The question as the finder reads it: enough to judge what fits without the answer key. */
export type Asked = {
  prompt: string
  topic?: string | null
  quote?: string | null
  file?: string | null
  page?: number | null
  /** The right answer, so the search never names it. */
  answer?: string | null
}

const bad = (message: string) => new HTTPException(400, { message })

export const fileUrl = (name: string) => `/api/illustrations/file/${name}`

/** What a stored image is, from its first bytes, never from the name it came with. */
function sniff(b: Uint8Array): 'jpg' | 'png' | 'webp' | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'webp'
  return null
}

async function save(bytes: Uint8Array): Promise<string> {
  const ext = sniff(bytes)
  if (!ext) throw bad('That file is not a JPG, PNG or WebP picture.')
  if (bytes.length > MAX_BYTES) throw bad('The picture is larger than 5 MB. Use a smaller one.')
  await mkdir(DIR, { recursive: true })
  const name = `${randomBytes(12).toString('hex')}.${ext}`
  await writeFile(join(DIR, name), bytes)
  return name
}

/** A stored illustration's bytes and type, for the public GET. */
export async function readIllustration(name: string) {
  if (!NAME.test(name)) return null
  try {
    const path = join(DIR, name)
    await stat(path)
    const ext = name.split('.').pop()!
    return { bytes: await readFile(path), type: ext === 'jpg' ? 'image/jpeg' : `image/${ext}` }
  } catch {
    return null
  }
}

export async function exists(name: string) {
  return !!(await readIllustration(name))
}

/** A picture the teacher chose from their own files. */
export async function fromUpload(f: File): Promise<Illustration> {
  if (f.size > MAX_BYTES) throw bad(`${f.name} is larger than 5 MB. Use a smaller picture.`)
  const image = await save(new Uint8Array(await f.arrayBuffer()))
  return { image, imageAlt: '', imageCredit: null }
}

// ---- the module's own figures --------------------------------------------------------

const canvas = () => import('@napi-rs/canvas')

async function pagePicture(source: Source, page: number): Promise<Buffer | null> {
  const bytes = new Uint8Array(await readFile(source.path))
  if (source.mime === 'application/pdf') {
    const { renderPageAsImage } = await import('unpdf')
    const png = await renderPageAsImage(bytes, page, { canvasImport: canvas, scale: 2 })
    return Buffer.from(png)
  }
  if (page !== 1) return null
  // A HEIC photo cannot be decoded here; JPG, PNG and WebP can.
  return sniff(bytes) ? Buffer.from(bytes) : null
}

/** The box, padded a little and kept on the picture, as a JPEG of its own. */
async function crop(picture: Buffer, box: number[]): Promise<Buffer | null> {
  const { loadImage, createCanvas } = await canvas()
  const img = await loadImage(picture)
  const [y0, x0, y1, x1] = box.map((v) => Math.min(1000, Math.max(0, v)) / 1000) as [number, number, number, number]
  const pad = 0.015
  const left = Math.max(0, (Math.min(x0, x1) - pad) * img.width)
  const top = Math.max(0, (Math.min(y0, y1) - pad) * img.height)
  const right = Math.min(img.width, (Math.max(x0, x1) + pad) * img.width)
  const bottom = Math.min(img.height, (Math.max(y0, y1) + pad) * img.height)
  const w = Math.round(right - left)
  const h = Math.round(bottom - top)
  // A sliver or a whole page is not a figure.
  if (w < 60 || h < 60 || (w * h) / (img.width * img.height) > 0.85) return null
  const scale = Math.min(1, 1200 / Math.max(w, h))
  const c = createCanvas(Math.round(w * scale), Math.round(h * scale))
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.drawImage(img, left, top, w, h, 0, 0, c.width, c.height)
  return c.encode('jpeg', 88)
}

const RULES = `You help a teacher add a picture to one quiz question.
- figures: the figures on the attached page (a photograph, drawing, diagram, chart, map or table) that would help a student understand the question, at most 2, the best first. Give each one's box_2d as [ymin, xmin, ymax, xmax] scaled 0 to 1000 around the whole figure and its caption, and alt: one sentence saying what the figure shows. A figure must not give the answer away. Never box a paragraph of plain text, a heading, a logo or the whole page. With no page attached, or no such figure on it, return an empty list.
- search: 2 to 4 English words to look up a picture of the question's subject on Wikimedia Commons, such as "copper wire" or "rice terraces". Name a thing, a material, a place or a process from the question itself. The answer is given to you so that you can keep it out: the search must not contain the answer, any of the options, or a word that appears only in the supporting sentence. For "which metal is liquid at room temperature" the search is "metal samples", never "liquid mercury".`

const FIND = S.obj(
  {
    figures: S.arr(
      S.obj(
        {
          box_2d: S.arr(S.int(), '[ymin, xmin, ymax, xmax], each 0 to 1000.'),
          alt: S.str('One sentence: what the figure shows.'),
        },
        ['box_2d', 'alt'],
      ),
    ),
    search: S.str('2 to 4 English words for a picture search.'),
  },
  ['figures', 'search'],
)

function describe(q: Asked) {
  return [
    `Question: ${q.prompt}`,
    q.topic ? `Topic: ${q.topic}` : '',
    q.quote ? `The module's sentence behind it: ${q.quote}` : '',
    q.answer ? `The answer (keep it out of the search): ${q.answer}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/** The page the question's quote was found on, as a source and a page number. */
function pageOf(q: Asked, sources: Source[]) {
  const ready = sources.filter((s) => s.status === 'ready')
  const source = (q.file && ready.find((s) => s.name === q.file)) || (ready.length === 1 ? ready[0] : null)
  if (!source || !q.page || q.page < 1) return null
  return { source, page: q.page }
}

function safeSearch(search: string, q: Asked) {
  const answer = (q.answer ?? '').toLowerCase()
  const words = search
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !(answer && answer.includes(w)))
  const out = words.join(' ').trim().slice(0, 60)
  return out || (q.topic ?? '').toLowerCase().slice(0, 60)
}

const STOP = new Set(['the', 'and', 'with', 'from', 'for', 'of', 'in', 'on', 'a', 'an', 'to', 'at', 'by'])

/** A Commons search hit is kept when its title or description shares a word with the search. */
function fits(c: Candidate, search: string) {
  const hay = `${c.alt} ${c.ref}`.toLowerCase()
  const words = search.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w))
  return !words.length || words.some((w) => hay.includes(w))
}

// ---- Wikimedia Commons --------------------------------------------------------------

const strip = (html: unknown) =>
  String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

async function wiki(host: string, params: Record<string, string>) {
  const url = `https://${host}/w/api.php?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) return null
  return (await res.json()) as any
}

const PICTURES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'image/tiff'])

function toCandidate(page: any): Candidate | null {
  const info = page?.imageinfo?.[0]
  if (!info?.thumburl || !PICTURES.has(info.mime)) return null
  const meta = info.extmetadata ?? {}
  const artist = strip(meta.Artist?.value).slice(0, 120) || 'Unknown author'
  const license = strip(meta.LicenseShortName?.value) || 'see the file page'
  const title = String(page.title ?? '').replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '')
  const alt = (strip(meta.ImageDescription?.value) || title).slice(0, 200)
  return {
    kind: 'wikimedia',
    preview: info.thumburl,
    alt,
    credit: { from: 'wikimedia', text: `${artist}, ${license}, via Wikimedia Commons`, url: info.descriptionurl ?? null },
    ref: info.thumburl,
  }
}

const INFO = { prop: 'imageinfo', iiprop: 'url|mime|extmetadata', iiurlwidth: '800' }

async function commons(term: string, limit = 6): Promise<Candidate[]> {
  const out: Candidate[] = []
  const seen = new Set<string>()
  const add = (c: Candidate | null) => {
    if (c && !seen.has(c.ref) && out.length < limit) {
      seen.add(c.ref)
      out.push(c)
    }
  }
  const [articles, search] = await Promise.all([
    wiki('en.wikipedia.org', { action: 'query', generator: 'search', gsrsearch: term, gsrlimit: '3', prop: 'pageimages', piprop: 'name', pilicense: 'free' }).catch(() => null),
    wiki('commons.wikimedia.org', { action: 'query', generator: 'search', gsrnamespace: '6', gsrsearch: `${term} filetype:bitmap|drawing`, gsrlimit: '8', ...INFO }).catch(() => null),
  ])
  const leads = ((articles?.query?.pages ?? []) as any[])
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((p) => p.pageimage)
    .filter(Boolean) as string[]
  if (leads.length) {
    const files = await wiki('commons.wikimedia.org', { action: 'query', titles: leads.map((n) => `File:${n}`).join('|'), ...INFO }).catch(() => null)
    const byTitle = new Map(((files?.query?.pages ?? []) as any[]).map((p) => [String(p.title).replace(/^File:/, '').replace(/ /g, '_'), p]))
    for (const n of leads) add(toCandidate(byTitle.get(n.replace(/ /g, '_'))))
  }
  for (const p of ((search?.query?.pages ?? []) as any[]).sort((a, b) => (a.index ?? 0) - (b.index ?? 0))) {
    const c = toCandidate(p)
    if (c && fits(c, term)) add(c)
  }
  return out
}

// ---- finding and attaching ------------------------------------------------------------

export async function find(q: Asked, sources: Source[]) {
  const started = performance.now()
  const where = pageOf(q, sources)
  const picture = where ? await pagePicture(where.source, where.page).catch(() => null) : null
  const parts: Part[] = []
  if (picture) parts.push({ inlineData: { mimeType: sniff(picture) === 'jpg' ? 'image/jpeg' : `image/${sniff(picture)}`, data: picture.toString('base64') } })
  parts.push({ text: `${describe(q)}\n\n${picture ? 'The attached picture is the page of the module this question comes from.' : 'No page is attached.'}` })
  const { data, model } = await generate<{ figures: { box_2d: number[]; alt: string }[]; search: string }>({
    task: 'illustrate',
    system: RULES,
    parts,
    schema: FIND,
    temperature: 0.2,
    timeout: 45_000,
  })

  const candidates: Candidate[] = []
  if (picture && where) {
    for (const f of (data.figures ?? []).slice(0, 2)) {
      if (!Array.isArray(f.box_2d) || f.box_2d.length !== 4) continue
      const jpg = await crop(picture, f.box_2d).catch(() => null)
      if (!jpg) continue
      const name = await save(new Uint8Array(jpg))
      candidates.push({
        kind: 'module',
        preview: fileUrl(name),
        alt: String(f.alt ?? '').slice(0, 300),
        credit: { from: 'module', text: `From ${where.source.name}, page ${where.page}`, url: null },
        ref: name,
      })
    }
  }
  const search = safeSearch(String(data.search ?? ''), q)
  if (search) candidates.push(...(await commons(search).catch(() => [])))
  return { candidates, search, model, ms: Math.round(performance.now() - started) }
}

/** Makes a chosen candidate the question's: a crop is already ours; a Commons picture is copied. */
export async function attach(c: { kind?: unknown; ref?: unknown; alt?: unknown; credit?: any }): Promise<Illustration> {
  const alt = String(c.alt ?? '').slice(0, 300)
  if (c.kind === 'module') {
    const name = String(c.ref ?? '')
    if (!(await exists(name))) throw bad('That crop is gone. Find pictures again.')
    return { image: name, imageAlt: alt, imageCredit: { from: 'module', text: String(c.credit?.text ?? '').slice(0, 300), url: null } }
  }
  if (c.kind === 'wikimedia') {
    const url = new URL(String(c.ref ?? ''))
    // Commons serves originals from upload.wikimedia.org and thumbnails from thumb.wikimedia.org.
    if (url.protocol !== 'https:' || !/^(upload|thumb)\.wikimedia\.org$/.test(url.hostname))
      throw bad('Only pictures from Wikimedia Commons can be attached this way.')
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new HTTPException(502, { message: 'Wikimedia Commons did not send the picture. Try another one.' })
    const bytes = new Uint8Array(await res.arrayBuffer())
    const image = await save(bytes)
    const credit = c.credit ?? {}
    return {
      image,
      imageAlt: alt,
      imageCredit: {
        from: 'wikimedia',
        text: String(credit.text ?? 'Wikimedia Commons').slice(0, 300),
        url: typeof credit.url === 'string' && credit.url.startsWith('https://commons.wikimedia.org/') ? credit.url : null,
      },
    }
  }
  throw bad('Choose a picture to attach.')
}
