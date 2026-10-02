
export type Entry = { index: number; number: number; row: number; col: number; dir: 'across' | 'down'; length: number }
export type Layout = { rows: number; cols: number; entries: Entry[]; left: number[] }

const MIN = 2
const MAX = 20

/** The letters a crossword cell can hold: A to Z and 0 to 9, uppercased, accents folded (é → E, ñ → N), everything else dropped. */
export function letters(answer: string): string {
  return answer
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

type Dir = Entry['dir']
type Cell = { ch: string; across: boolean; down: boolean }
type Placed = { index: number; word: string; row: number; col: number; dir: Dir }
type Box = { top: number; left: number; bottom: number; right: number }
type Spot = { row: number; col: number; dir: Dir; crossings: number; area: number }

const key = (row: number, col: number) => `${row},${col}`

/** The box around the placed words once one more word is added. */
function grow(box: Box, row: number, col: number, dir: Dir, length: number): Box {
  const bottom = dir === 'down' ? row + length - 1 : row
  const right = dir === 'across' ? col + length - 1 : col
  return {
    top: Math.min(box.top, row),
    left: Math.min(box.left, col),
    bottom: Math.max(box.bottom, bottom),
    right: Math.max(box.right, right),
  }
}

function crossingsAt(grid: Map<string, Cell>, word: string, row: number, col: number, dir: Dir): number {
  const dr = dir === 'down' ? 1 : 0
  const dc = dir === 'across' ? 1 : 0
  if (grid.has(key(row - dr, col - dc))) return 0
  if (grid.has(key(row + dr * word.length, col + dc * word.length))) return 0
  let crossings = 0
  for (let i = 0; i < word.length; i++) {
    const r = row + dr * i
    const c = col + dc * i
    const cell = grid.get(key(r, c))
    if (cell) {
      if (cell.ch !== word[i] || cell[dir]) return 0
      crossings++
    } else if (grid.has(key(r - dc, c - dr)) || grid.has(key(r + dc, c + dr))) {
      // A new cell with a filled neighbor at its side: side by side.
      return 0
    }
  }
  return crossings
}

/** Whether spot `a` beats spot `b`: more crossings, then the smaller box, then higher up, then further left, then across. */
function better(a: Spot, b: Spot): boolean {
  if (a.crossings !== b.crossings) return a.crossings > b.crossings
  if (a.area !== b.area) return a.area < b.area
  if (a.row !== b.row) return a.row < b.row
  if (a.col !== b.col) return a.col < b.col
  return a.dir === 'across' && b.dir === 'down'
}

/** The best position for the word on the grid as it stands, or null when it can cross nothing. */
function bestSpot(grid: Map<string, Cell>, box: Box, word: string): Spot | null {
  let best: Spot | null = null
  const seen = new Set<string>()
  for (const [at, cell] of grid) {
    const [r, c] = at.split(',').map(Number) as [number, number]
    for (let i = 0; i < word.length; i++) {
      if (word[i] !== cell.ch) continue
      for (const dir of ['across', 'down'] as const) {
        const row = dir === 'down' ? r - i : r
        const col = dir === 'across' ? c - i : c
        // A position with two crossings is reached from both of them.
        const id = `${row},${col},${dir}`
        if (seen.has(id)) continue
        seen.add(id)
        const crossings = crossingsAt(grid, word, row, col, dir)
        if (!crossings) continue
        const b = grow(box, row, col, dir, word.length)
        const spot: Spot = { row, col, dir, crossings, area: (b.bottom - b.top + 1) * (b.right - b.left + 1) }
        if (!best || better(spot, best)) best = spot
      }
    }
  }
  return best
}

/** Lays the words out as a crossword. `index` in each entry is the word's position in the input. */
export function layout(words: string[]): Layout {
  const left: number[] = []
  let waiting: { index: number; word: string }[] = []
  words.forEach((raw, index) => {
    const word = letters(raw)
    if (word.length < MIN || word.length > MAX) left.push(index)
    else waiting.push({ index, word })
  })
  // Longest first; the sort is stable, so equal lengths keep input order.
  waiting.sort((a, b) => b.word.length - a.word.length)

  const grid = new Map<string, Cell>()
  const placed: Placed[] = []
  let box: Box = { top: 0, left: 0, bottom: 0, right: 0 }

  const put = (index: number, word: string, row: number, col: number, dir: Dir) => {
    for (let i = 0; i < word.length; i++) {
      const at = dir === 'across' ? key(row, col + i) : key(row + i, col)
      const cell = grid.get(at) ?? { ch: word[i]!, across: false, down: false }
      cell[dir] = true
      grid.set(at, cell)
    }
    box = placed.length ? grow(box, row, col, dir, word.length) : grow({ top: row, left: col, bottom: row, right: col }, row, col, dir, word.length)
    placed.push({ index, word, row, col, dir })
  }

  const first = waiting.shift()
  if (first) put(first.index, first.word, 0, 0, 'across')

  while (first && waiting.length) {
    let done = false
    for (const w of waiting) {
      const spot = bestSpot(grid, box, w.word)
      if (!spot) continue
      put(w.index, w.word, spot.row, spot.col, spot.dir)
      waiting = waiting.filter((x) => x !== w)
      done = true
      break
    }
    if (!done) break
  }
  for (const w of waiting) left.push(w.index)
  left.sort((a, b) => a - b)

  if (!placed.length) return { rows: 0, cols: 0, entries: [], left }

  const numbers = new Map<string, number>()
  const starts = placed
    .map((p) => ({ ...p, row: p.row - box.top, col: p.col - box.left }))
    .sort((a, b) => a.row - b.row || a.col - b.col || (a.dir === b.dir ? 0 : a.dir === 'across' ? -1 : 1))
  const entries: Entry[] = starts.map((p) => {
    const at = key(p.row, p.col)
    if (!numbers.has(at)) numbers.set(at, numbers.size + 1)
    return { index: p.index, number: numbers.get(at)!, row: p.row, col: p.col, dir: p.dir, length: p.word.length }
  })

  return { rows: box.bottom - box.top + 1, cols: box.right - box.left + 1, entries, left }
}
