
/** Lowercase, one kind of quote and dash, no soft hyphens, single spaces. */
export function normalize(s: string) {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/­/g, '') // soft hyphens a PDF leaves in broken words
    .replace(/-\s*\n\s*/g, '') // a word broken across lines
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

const words = (s: string) => normalize(s).match(/[\p{L}\p{N}]+/gu) ?? []

function bestOrderedOverlap(quote: string[], text: string[]) {
  const n = quote.length
  if (!n || !text.length) return 0
  const span = n + Math.ceil(n * 0.25) + 2
  let best = 0
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== quote[0] && text[start] !== quote[1]) continue
    const win = text.slice(start, start + span)
    // LCS over words, one row at a time.
    let prev = new Array(win.length + 1).fill(0)
    for (let i = 1; i <= n; i++) {
      const row = new Array(win.length + 1).fill(0)
      for (let j = 1; j <= win.length; j++)
        row[j] = quote[i - 1] === win[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1])
      prev = row
    }
    best = Math.max(best, prev[win.length] / n)
    if (best === 1) break
  }
  return best
}

export type Grounding = { found: boolean; page: number | null }

export function ground(quote: string | null | undefined, pages: string[], page?: number | null): Grounding {
  if (!quote || !pages.length) return { found: false, page: null }
  const q = normalize(quote)
  const qw = words(quote)
  if (qw.length < 3) return { found: false, page: null }

  const order = [...pages.keys()]
  if (page && page >= 1 && page <= pages.length) order.unshift(page - 1)

  for (const i of order) if (normalize(pages[i]!).includes(q)) return { found: true, page: i + 1 }
  for (const i of order) if (bestOrderedOverlap(qw, words(pages[i]!)) >= 0.85) return { found: true, page: i + 1 }
  return { found: false, page: null }
}
