<script setup lang="ts">
import { computed } from "vue"

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
      const ch = typed[i]
      if (ch && (e.active || !cell.held)) {
        cell.ch = ch
        cell.held = !!e.active
      }
    }
  }
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
    stroke: color-mix(in srgb, var(--ink) 38%, var(--surface));
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
