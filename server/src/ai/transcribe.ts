import { generate, S, type Part } from './gemini.ts'

/*
 * The AI's reading of what has no text layer: a photo of a page, or the pages
 * of a scanned PDF. It runs once, when the file is uploaded, and the text it
 * returns is what the draft, the chat edits and the grounding check use from
 * then on. A question's quote has to be found in that text word for word, so
 * the transcription is exact and never a summary.
 */
const RULES = `You transcribe study material for a quiz maker. Questions will quote your text word for word, so it must be exactly what is printed.
- Copy every word as printed, in reading order: headings, paragraphs, list items, captions, labels. Keep the original language (often English or Filipino), spelling and punctuation. Do not correct, translate, summarize, shorten or add anything.
- A table: one line per row, its cells in order, separated by single spaces.
- A figure, diagram or picture: one line in square brackets saying what it shows, starting "Figure:", followed by any text printed in it.
- Leave out page numbers, and headers or footers that repeat on every page.
- A page with nothing readable gets an empty string.`

const SCHEMA = S.obj({
  pages: S.arr(
    S.obj({
      page: S.int('1-based page number within this file.'),
      text: S.str('Everything printed on the page, transcribed exactly.'),
    }),
  ),
})

/** Transcribes a file of `pages` pages (a photo is one); returns each page's text in order. */
export async function transcribe(file: Part, pages: number, kind: 'pdf' | 'photo') {
  const ask =
    kind === 'photo'
      ? 'This is a photo of study material. Transcribe it as page 1.'
      : `This PDF has ${pages} ${pages === 1 ? 'page' : 'pages'}. Transcribe every page, numbered from 1.`
  const { data, ms, model } = await generate<{ pages: { page: number; text: string }[] }>({
    task: 'read',
    system: RULES,
    parts: [file, { text: ask }],
    schema: SCHEMA,
    temperature: 0,
    timeout: 120_000,
  })
  const out = Array.from({ length: pages }, () => '')
  for (const p of data.pages ?? []) {
    if (Number.isInteger(p.page) && p.page >= 1 && p.page <= pages) out[p.page - 1] = String(p.text ?? '').trim()
  }
  return { pages: out, ms, model }
}
