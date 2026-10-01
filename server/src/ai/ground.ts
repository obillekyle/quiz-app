/**
 * The grounding check: is the sentence a question cites really in the
 * material? Plain code, not AI, so the answer to "what if the AI made it up"
 * does not depend on the AI.
 */

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

/**
 * How much of `quote` appears, in order, within a window of `text` about as
 * long as the quote: the best longest-common-subsequence over windows,
 * divided by the quote's length. 1 means every word is there in order.
 */
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

/**
 * Looks for `quote` in the material's pages (1-based `page` first, then the
 * rest). Found when the normalized quote appears as it is, or when at least
 * 85% of its words appear in order in one place: enough to forgive a word the
 * PDF's text layer split or joined, not enough to pass a sentence that is not
 * there.
 */
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
