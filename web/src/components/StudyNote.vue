<script setup lang="ts">
import { computed, ref, watch } from "vue"
import Icon from "./Icon.vue"
import type { Advice } from "../composables/take"

/**
 * "What to review": the AI's study note on a finished attempt, offered once
 * its results show. Before it is asked for, a card says what it is and what
 * is not sent. While it is written, the card and the rows under it are drawn
 * in the shape of what is coming. Written, it is one sentence on what went
 * right, then up to three topics to go over, each with the questions it
 * rests on and where in the material to look.
 *
 * With nothing missed the server's one sentence stands alone: no rows, and
 * no line saying the AI wrote it, since it did not.
 *
 * The page holds the note and asks for it, so the card under the score and
 * the one above the review are one note in one state. Above the review the
 * written note is folded to its title and the names of its topics, with the
 * rows behind "Show the note": whole, it is 616px tall on a phone and took
 * the first screen from the answers the review is opened for.
 */
const props = defineProps<{
  note: Advice | null
  /** The note is being written. */
  busy: boolean
  /** The server's message when the last request failed; empty otherwise. */
  error: string
  /** Above the review: a written note starts folded. */
  compact?: boolean
}>()
defineEmits<{ ask: [] }>()

/** There are rows to fold away; the one-sentence note with nothing to review never folds. */
const foldable = computed(() => !!props.compact && !!props.note?.review.length)
const open = ref(!props.compact)
const topics = computed(
  () => props.note?.review.map((r) => r.topic).join(", ") ?? "",
)

/**
 * The note arrived while this card was on screen, as against a card mounted
 * with its note already written (a reload, or the way to the review). Only
 * the first is a reveal, and only a reveal animates. A note asked for from
 * the folded card opens it: it was asked for to be read.
 */
const reveal = ref(false)
watch(
  () => props.note,
  (now, before) => {
    if (now && !before) {
      reveal.value = true
      open.value = true
    }
  },
)
</script>

<template>
  <section
    class="study"
    aria-labelledby="study-title"
    :data-reveal="reveal || undefined"
    :style="{ '--n': note?.review.length ?? 0 }"
  >
    <div class="card">
      <h2 id="study-title">
        <Icon name="sparkle" :size="18" />
        What to review
      </h2>
      <template v-if="note">
        <p v-if="foldable && !open" class="topics">{{ topics }}</p>
        <p v-else class="strengths">{{ note.strengths }}</p>
        <button
          v-if="foldable"
          type="button"
          class="fold"
          :aria-expanded="open"
          aria-controls="study-rows"
          @click="open = !open"
        >
          {{ open ? "Hide the note" : "Show the note" }}
          <Icon name="chevron" :size="16" />
        </button>
      </template>
      <template v-else-if="busy">
        <p class="working" role="status">
          <span class="dots" aria-hidden="true"><i /><i /><i /></span>
          Writing your study note…
        </p>
        <div class="lines" aria-hidden="true">
          <div skeleton="text" style="width: 92%" />
          <div skeleton="text" style="width: 58%" />
        </div>
      </template>
      <template v-else>
        <p class="lead">
          The AI reads your answers and says what to study next. Your name is
          not sent.
        </p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <button type="button" btn="primary" @click="$emit('ask')">
          {{ error ? "Try again" : "Write my study note" }}
        </button>
      </template>
    </div>

    <ul v-if="note?.review.length && open" id="study-rows" class="rows" stack>
      <li v-for="(r, i) in note.review" :key="i" :style="{ '--i': i }">
        <h3>{{ r.topic }}</h3>
        <p>{{ r.why }}</p>
        <p v-if="r.where" class="where">
          Where to look: <b>{{ r.where }}</b>
        </p>
      </li>
    </ul>
    <ul v-else-if="busy && !note" class="rows" stack aria-hidden="true">
      <li v-for="n in 2" :key="n">
        <div skeleton="text" style="width: 38%" />
        <div skeleton="text" style="width: 90%" />
        <div skeleton="text" style="width: 64%" />
      </li>
    </ul>
    <p v-if="note?.review.length && open" class="fine">
      Written by the AI from your answers. It can be wrong.
    </p>
  </section>
</template>

<style scoped>
.study {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* The take page's card: its radius, its inset, the surface. */
.card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 18px;
  border-radius: var(--radius-xl);
  background: var(--surface);

  p {
    margin: 0;
  }
}
h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 17px;
  line-height: 1.3;

  svg {
    flex: none;
    color: var(--accent-text, var(--accent));
  }
}
.lead {
  font-size: 14px;
  line-height: 1.5;
  color: var(--muted);
  text-wrap: pretty;
}
/* No larger than the rows under it: the topics are what the title promises. */
.strengths,
.topics {
  font-size: 14px;
  line-height: 1.5;
  text-wrap: pretty;
}
/* Folded and unfolded by a text button in the accent, as a question's hint
   is: 44px to the finger, its chevron turning with it. The margins take
   back what the target adds, so the folded card stays short. */
.fold {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 6px;
  min-height: 44px;
  margin: -6px 0 -12px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-md);
  background: none;
  color: var(--accent-text, var(--accent));
  font: inherit;
  font-size: 14px;
  font-weight: 650;
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid var(--accent-text, var(--accent));
    outline-offset: 2px;
  }
  &[aria-expanded="true"] svg {
    rotate: 180deg;
  }
}
.error {
  font-size: 14px;
  color: var(--bad);
}
[btn] {
  align-self: flex-start;
  margin-top: 4px;
  border-radius: var(--radius-full);

  /* A line on the page: the tone that reads there, not the fill's. */
  &:focus-visible {
    outline-color: var(--accent-text, var(--accent));
  }
}

/* While the note is written: the working dots, then lines where the
   sentence will be, and two tiles where the rows will be. */
.working {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  color: var(--muted);
}
.lines {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px 0 2px;
}
.dots {
  display: inline-flex;
  gap: 4px;

  i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent-text, var(--accent));
    animation: blink 1.2s infinite ease-in-out both;
  }
  i:nth-child(2) {
    animation-delay: 0.15s;
  }
  i:nth-child(3) {
    animation-delay: 0.3s;
  }
}
@keyframes blink {
  0%,
  80%,
  100% {
    opacity: 0.25;
    transform: scale(0.8);
  }
  40% {
    opacity: 1;
    transform: scale(1);
  }
}

/* One tile a topic: its name, what was missed, where to look. */
.rows li {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 18px;

  h3 {
    margin: 0;
    font-size: 15px;
    line-height: 1.35;
  }
  p {
    margin: 0;
    font-size: 14px;
    line-height: 1.5;
    text-wrap: pretty;
  }
  [skeleton] {
    margin: 4px 0;
  }
}
/* The label is the same on every row; the place is what a person acts on. */
.rows .where {
  color: var(--muted);

  b {
    font-weight: 600;
    color: var(--ink);
  }
}
.fine {
  margin: 0;
  padding: 0 18px;
  font-size: 13px;
  color: var(--muted);
}

/* The reveal, in reading order: the sentence, each row after the one
   above, then the line under them. Each rises 8px into place. */
.study[data-reveal] {
  .strengths,
  .rows > li,
  .fine {
    animation: rise-in 200ms var(--ease-emphasized-decelerate) both;
  }
  .rows > li {
    animation-delay: calc((var(--i, 0) + 1) * 40ms);
  }
  .fine {
    animation-delay: calc((var(--n, 0) + 1) * 40ms);
  }
}
@keyframes rise-in {
  from {
    opacity: 0;
    translate: 0 8px;
  }
}
</style>
