<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue"

/**
 * The questions pane while the AI drafts: four cards in the shape of what is
 * coming, each filled in piece by piece (its header row, its prompt, four
 * options), a card every 1.5 s, round again once all four are drawn. The
 * status line above is the phase the server is in, on a timer tuned to the
 * measured draft; the cards count nothing.
 */
defineProps<{
  /** The phase the AI is in: reading, writing, checking. */
  status: string
}>()

const CARDS = 4
const PIECES = 6
/** One piece every 250 ms: a card's six pieces fill in 1.5 s. */
const STEP = 250
/** All four drawn, a short hold, then from the top. */
const CYCLE = CARDS * PIECES + 2
// With reduced motion asked for, the four cards stand whole and nothing
// loops: the status line alone says the work is going on.
const still = matchMedia("(prefers-reduced-motion: reduce)").matches
const tick = ref(still ? CYCLE : 0)
const timer = still
  ? undefined
  : setInterval(() => (tick.value = (tick.value + 1) % CYCLE), STEP)
onBeforeUnmount(() => clearInterval(timer))
const on = (card: number, piece: number) => tick.value >= card * PIECES + piece
</script>

<template>
  <div class="preview">
    <p class="phase" role="status" aria-live="polite">{{ status }}</p>
    <p class="note">The AI is drafting your quiz...</p>
    <div class="cards" aria-hidden="true">
      <div v-for="c in CARDS" :key="c" class="card">
        <div class="row" :data-on="on(c - 1, 0) || undefined">
          <span skeleton="round" class="num" />
          <span skeleton class="sel" />
          <span skeleton class="sel" />
        </div>
        <div
          skeleton="text"
          class="prompt"
          :data-on="on(c - 1, 1) || undefined"
        />
        <div
          v-for="k in 4"
          :key="k"
          skeleton
          class="opt"
          :data-on="on(c - 1, 1 + k) || undefined"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.preview {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 820px;
  margin: 0 auto;
}
.phase {
  margin: 0;
  font: 650 17px var(--font-heading);
}
.note {
  margin: 0 0 14px;
  font-size: 13px;
  color: var(--muted);
}
.cards {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 18px;
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  background: var(--surface);
}
.row {
  display: flex;
  gap: 8px;
}
.num {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-md);
}
.sel {
  width: 120px;
  height: 28px;
}
.prompt {
  width: 70%;
  height: 1.4em;
}
.opt {
  height: 40px;
}
/* A piece is drawn when its turn comes: it rises 6px into place, 200 ms,
   and all of a card's pieces go out together when the loop starts over. */
.row,
.prompt,
.opt {
  opacity: 0;
  translate: 0 6px;
  transition:
    opacity 200ms var(--ease-emphasized-decelerate),
    translate 200ms var(--ease-emphasized-decelerate);

  &[data-on] {
    opacity: 1;
    translate: none;
  }
}
</style>
