<script setup lang="ts">
import { computed } from "vue"

/**
 * Responses per day as one thin line, like the activity line beside a
 * repository on GitHub: flat on the baseline on quiet days, a peak on a day
 * a class answered. Scaled to its own busiest day, so it shows the shape of
 * the two weeks, not a count; the count is in its label.
 *
 * The line sits in a rounded square (Kyle, 23:55), 40 px with an
 * 8 px corner like the list's color square, so the row reads square, title,
 * meta, then the globe and this square. A square that size holds two weeks
 * legibly (2 px a day), the same window as the overview's chart.
 */
const props = withDefaults(
  defineProps<{ counts: number[]; width?: number; height?: number }>(),
  { width: 28, height: 22 },
)

const PAD = 2
const total = computed(() => props.counts.reduce((a, b) => a + b, 0))
const points = computed(() => {
  const n = props.counts.length
  if (n < 2) return ""
  const max = Math.max(1, ...props.counts)
  const step = (props.width - PAD * 2) / (n - 1)
  const h = props.height - PAD * 2
  return props.counts
    .map((c, i) => {
      const x = PAD + i * step
      const y = PAD + h - (c / max) * h
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(" ")
})
const label = computed(() => {
  const n = total.value
  const days = props.counts.length
  return n
    ? `${n} ${n === 1 ? "response" : "responses"} in the last ${days} days.`
    : `No responses in the last ${days} days.`
})
</script>

<template>
  <span class="tile" :data-quiet="!total || undefined" :title="label">
    <svg
      :width="width"
      :height="height"
      :viewBox="`0 0 ${width} ${height}`"
      role="img"
      :aria-label="label"
    >
      <polyline :points="points" />
    </svg>
  </span>
</template>

<style scoped>
.tile {
  display: inline-grid;
  place-items: center;
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--good) 8%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--good) 18%, var(--line));

  svg {
    display: block;
    overflow: visible;
  }
  polyline {
    fill: none;
    stroke: var(--good);
    stroke-width: 1.75;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  &[data-quiet] {
    background: color-mix(in srgb, var(--ink) 3%, var(--surface));
    border-color: var(--line);

    polyline {
      stroke: color-mix(in srgb, var(--ink) 25%, transparent);
    }
  }
}
</style>
