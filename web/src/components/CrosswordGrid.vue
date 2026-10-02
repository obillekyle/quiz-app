<script setup lang="ts">
import { computed } from "vue"

/**
 * A crossword's grid, for looking at: one square per cell that belongs to a
 * word, each word's number in the corner of its first cell, and whatever
 * has been typed for a word so far, a character a cell. It takes no input
 * itself; the page that owns the answers passes them in as `text`.
 *
 * Cells that belong to no word are not drawn at all. A classic grid blacks
 * them out, and a layout made from a handful of answers is mostly such
 * cells: on paper that is a page of solid ink for nothing.
 *
 * One inline svg in cell units, so a wide grid shrinks to its container and
 * a small one stops at 40 px a cell. The strokes do not scale with it: a
 * line stays a line at any width.
 */
const props = defineProps<{
  rows: number
  cols: number
  entries: {
    number: number
    row: number
    col: number
    dir: "across" | "down"
    length: number
    text?: string
    active?: boolean
  }[]
  print?: boolean
}>()

const CELL = 40
/* Room for the outer strokes, half of which fall outside the cells. */
const PAD = 1

/**
 * What a cell can hold. Mirrors `letters()` in server/src/quiz/crossword.ts,
 * the rule the layout was made by: uppercase, accents folded, A to Z and 0
 * to 9 only. The two have to agree, or a typed answer would land in
 * different cells here than the ones the server counted for it.
 */
function fold(s: string) {
  return s
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
}

type Cell = {
  key: string
  x: number
  y: number
  number: number | null
  ch: string
  active: boolean
  /** The letter came from the active entry, and no other entry replaces it. */
  held: boolean
}

const cells = computed(() => {
  const map = new Map<string, Cell>()
  for (const e of props.entries) {
    const typed = fold(e.text ?? "")
    for (let i = 0; i < e.length; i++) {
      const row = e.dir === "down" ? e.row + i : e.row
      const col = e.dir === "across" ? e.col + i : e.col
      const key = `${row},${col}`
      let cell = map.get(key)
      if (!cell) {
        cell = {
          key,
          x: col * CELL,
          y: row * CELL,
          number: null,
          ch: "",
          active: false,
          held: false,
        }
        map.set(key, cell)
      }
      if (i === 0) cell.number = e.number
      if (e.active) cell.active = true
      // Where two words cross and disagree, the one being typed shows;
      // with neither active, the later one does.
      const ch = typed[i]
      if (ch && (e.active || !cell.held)) {
        cell.ch = ch
        cell.held = !!e.active
      }
    }
  }
  // The active word is drawn last, so its heavier border lies over the
  // lines of the cells beside it.
  return [...map.values()].sort((a, b) => Number(a.active) - Number(b.active))
})

const viewBox = computed(
  () =>
    `${-PAD} ${-PAD} ${props.cols * CELL + PAD * 2} ${props.rows * CELL + PAD * 2}`,
)
const label = computed(() => {
  const n = props.entries.length
  return `Crossword, ${n} ${n === 1 ? "word" : "words"}, ${props.rows} by ${props.cols}.`
})
</script>

<template>
  <svg
    v-if="cells.length"
    class="crossword"
    :data-print="print || undefined"
    :viewBox="viewBox"
    :style="{ maxWidth: `${cols * CELL}px` }"
    role="img"
    :aria-label="label"
  >
    <g v-for="c in cells" :key="c.key" :data-active="c.active || undefined">
      <rect :x="c.x" :y="c.y" :width="CELL" :height="CELL" />
      <text v-if="c.number !== null" class="number" :x="c.x + 4" :y="c.y + 11">
        {{ c.number }}
      </text>
      <text v-if="c.ch" class="letter" :x="c.x + CELL / 2" :y="c.y + 30">
        {{ c.ch }}
      </text>
    </g>
  </svg>
</template>

<style scoped>
.crossword {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
  font-family: inherit;

  rect {
    fill: var(--surface);
    stroke: var(--line);
    stroke-width: 1px;
    vector-effect: non-scaling-stroke;
  }
  [data-active] rect {
    fill: color-mix(in srgb, var(--accent, var(--good)) 16%, var(--surface));
    stroke: var(--accent, var(--good));
    stroke-width: 2px;
  }
  .number {
    font-size: 10px;
    fill: var(--muted);
  }
  .letter {
    font-size: 21px;
    font-weight: 600;
    text-anchor: middle;
    fill: var(--ink);
  }

  /* Paper: black hairlines on white and nothing tinted, whichever word was
     active when the sheet was made. */
  &[data-print] {
    rect,
    [data-active] rect {
      fill: #fff;
      stroke: #000;
      stroke-width: 0.75pt;
    }
    .number,
    .letter {
      fill: #000;
    }
  }
}

/* The same for a page printed straight from the browser, where the tokens
   turn black and the tint would come out gray. */
@media print {
  .crossword {
    rect,
    [data-active] rect {
      fill: #fff;
      stroke: #000;
      stroke-width: 0.75pt;
    }
    .number,
    .letter {
      fill: #000;
    }
  }
}
</style>
