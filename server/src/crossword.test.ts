import { describe, expect, test } from 'bun:test'
import { layout, letters, type Layout } from './quiz/crossword.ts'

const METALS = ['MERCURY', 'COPPER', 'ALLOY', 'BRASS', 'DUCTILE', 'LUSTER', 'ZINC']

type Filled = { ch: string; across: number[]; down: number[] }

/** The grid the entries describe. Throws nothing: disagreements are collected for the test to assert on. */
function rebuild(words: string[], l: Layout) {
  const cells = new Map<string, Filled>()
  const clashes: string[] = []
  const outside: string[] = []
  l.entries.forEach((e, n) => {
    const word = letters(words[e.index]!)
    for (let i = 0; i < e.length; i++) {
      const row = e.dir === 'down' ? e.row + i : e.row
      const col = e.dir === 'across' ? e.col + i : e.col
      const at = `${row},${col}`
      if (row < 0 || col < 0 || row >= l.rows || col >= l.cols) outside.push(at)
      const cell = cells.get(at) ?? { ch: word[i]!, across: [], down: [] }
      if (cell.ch !== word[i]) clashes.push(`${at}: ${cell.ch} and ${word[i]}`)
      cell[e.dir].push(n)
      cells.set(at, cell)
    }
  })
  return { cells, clashes, outside }
}

describe('the letters a cell can hold', () => {
  test('accents fold, spaces and punctuation go, capitals come', () => {
    expect(letters('Río de la Plata')).toBe('RIODELAPLATA')
    expect(letters('piñata, 2nd!')).toBe('PINATA2ND')
    expect(letters(' - ')).toBe('')
  })
})

describe('a crossword from a list of answers', () => {
  const l = layout(METALS)
  const { cells, clashes, outside } = rebuild(METALS, l)

  test('seven metals words place at least five', () => {
    expect(l.entries.length).toBeGreaterThanOrEqual(5)
    expect(l.entries.length + l.left.length).toBe(METALS.length)
    expect(new Set([...l.entries.map((e) => e.index), ...l.left]).size).toBe(METALS.length)
    for (const e of l.entries) expect(e.length).toBe(METALS[e.index]!.length)
  })

  test('every crossing holds one letter, and every cell is inside the cropped grid', () => {
    expect(clashes).toEqual([])
    expect(outside).toEqual([])
    const rows = [...cells.keys()].map((k) => Number(k.split(',')[0]))
    const cols = [...cells.keys()].map((k) => Number(k.split(',')[1]))
    expect(Math.min(...rows)).toBe(0)
    expect(Math.min(...cols)).toBe(0)
    expect(Math.max(...rows)).toBe(l.rows - 1)
    expect(Math.max(...cols)).toBe(l.cols - 1)
  })

  test('every word after the first crosses another', () => {
    l.entries.forEach((e, n) => {
      let crossed = 0
      for (const cell of cells.values()) if (cell[e.dir].includes(n) && cell.across.length && cell.down.length) crossed++
      if (l.entries.length > 1) expect(crossed).toBeGreaterThan(0)
    })
  })

  test('no two words of one direction overlap', () => {
    for (const cell of cells.values()) {
      expect(cell.across.length).toBeLessThanOrEqual(1)
      expect(cell.down.length).toBeLessThanOrEqual(1)
    }
  })

  test('no two words touch side by side or end to end', () => {
    const loose: string[] = []
    for (const [at, cell] of cells) {
      const [row, col] = at.split(',').map(Number) as [number, number]
      const right = cells.get(`${row},${col + 1}`)
      const below = cells.get(`${row + 1},${col}`)
      if (right && !cell.across.some((n) => right.across.includes(n))) loose.push(`${at} and its right`)
      if (below && !cell.down.some((n) => below.down.includes(n))) loose.push(`${at} and the cell below`)
    }
    expect(loose).toEqual([])
  })

  test('numbers rise in reading order, and a shared start shares its number', () => {
    const starts = new Map<string, number>()
    for (const e of l.entries) {
      const at = `${e.row},${e.col}`
      if (starts.has(at)) expect(starts.get(at)).toBe(e.number)
      starts.set(at, e.number)
    }
    const inOrder = [...starts.entries()]
      .map(([at, number]) => ({ row: Number(at.split(',')[0]), col: Number(at.split(',')[1]), number }))
      .sort((a, b) => a.row - b.row || a.col - b.col)
    expect(inOrder.map((s) => s.number)).toEqual(inOrder.map((_, i) => i + 1))
    // The list itself is by number, across before down.
    for (let i = 1; i < l.entries.length; i++) {
      const a = l.entries[i - 1]!
      const b = l.entries[i]!
      expect(a.number < b.number || (a.number === b.number && a.dir === 'across' && b.dir === 'down')).toBe(true)
    }
  })

  test('the same words give the same grid', () => {
    expect(layout(METALS)).toEqual(l)
    expect(layout([...METALS])).toEqual(layout([...METALS]))
  })

  test('the longest word goes first, across', () => {
    // MERCURY and DUCTILE are both seven letters; the earlier one leads.
    const lead = l.entries.find((e) => e.index === 0)!
    expect(lead.dir).toBe('across')
  })
})

describe('words the grid cannot take', () => {
  test('a word sharing no letter with the rest is left out', () => {
    const l = layout(['BRASS', 'ZINC', 'GOLD'])
    expect(l.entries.map((e) => e.index)).toEqual([0])
    expect(l.left).toEqual([1, 2])
    expect(l).toMatchObject({ rows: 1, cols: 5 })
  })
  test('one letter, no letters and more than twenty letters are left out', () => {
    const l = layout(['A', '', '?!', 'ALLOY', 'X'.repeat(21), 'LEAD'])
    expect(l.left).toEqual([0, 1, 2, 4])
    expect(l.entries.map((e) => e.index).sort()).toEqual([3, 5])
  })
  test('nothing in, nothing out', () => {
    expect(layout([])).toEqual({ rows: 0, cols: 0, entries: [], left: [] })
    expect(layout(['', 'Q'])).toEqual({ rows: 0, cols: 0, entries: [], left: [0, 1] })
  })
  test('an answer typed with spaces and accents is placed by its letters', () => {
    const l = layout(['Río de la Plata', 'plata'])
    expect(l.entries.find((e) => e.index === 0)!.length).toBe(12)
    expect(l.left).toEqual([])
  })
  test('a word is not laid along the top of another that contains it', () => {
    const words = ['ALLOYS', 'ALLOY']
    const l = layout(words)
    const { cells } = rebuild(words, l)
    for (const cell of cells.values()) expect(cell.across.length + cell.down.length).toBeLessThanOrEqual(2)
    expect(l.entries.map((e) => e.dir).sort()).toEqual(['across', 'down'])
  })
})
