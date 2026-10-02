<script setup lang="ts">
import { computed, ref, watch } from "vue"
import CrosswordGrid from "./CrosswordGrid.vue"
import Icon from "./Icon.vue"
import { KIND_LABEL } from "../composables/quizzes"
import type {
  Draft,
  Feedback,
  Given,
  GridEntry,
  PublicQuestion,
  ShownSet,
} from "../composables/take"

const props = withDefaults(
  defineProps<{
    question: PublicQuestion
    number: number
    feedback?: Given
    /** The pick not sent yet; without one, a saved pick shows. */
    draft?: Draft
    /** The pick is being sent. */
    busy?: boolean
    /** The original option indices in the order shown; the quiz's own order without it. */
    options?: number[]
    /** The finished attempt's review: nothing takes a pick. */
    review?: boolean
    /** Off, the "Show hint" control is not offered (a graded quiz). */
    showHints?: boolean
    aiCheck?: boolean
    aiEssay?: boolean
    /** The set this question is answered in: a word bank, or a crossword. */
    set?: ShownSet
    /** Crossword: every entry of the grid with what is written in it, this question's marked active. */
    grid?: GridEntry[]
    /** Word bank: the words already given to the set's other questions. */
    used?: string[]
  }>(),
  { showHints: true, aiCheck: true, aiEssay: true },
)
const emit = defineEmits<{
  /** The pick changed: an option chosen, or the text as typed. */
  pick: [draft: Draft]
  /** Enter in the one-line field: the page's button, from the keyboard. */
  confirm: []
}>()

const q = computed(() => props.question)
const f = computed(() => props.feedback)
/** The feedback, when the answer came back graded rather than held or only saved. */
const g = computed<Feedback | undefined>(() =>
  f.value && !f.value.held && !f.value.pick ? f.value : undefined,
)
/** The question still takes a pick: not checked yet, or saved on a quiz checked at the end. */
const open = computed(() => !props.review && (!f.value || !!f.value.pick))
/** What shows as picked: the pick not sent yet, else the saved one. */
const sel = computed<Draft>(() => {
  if (props.draft) return props.draft
  const fb = f.value
  if (!fb?.pick) return {}
  return { choice: fb.choice ?? undefined, text: fb.text ?? undefined }
})
/** The saved pick is the one on screen: nothing waits to be sent. */
const savedPick = computed(() => {
  const fb = f.value
  if (!fb?.pick) return false
  return (
    (sel.value.choice ?? null) === fb.choice &&
    (sel.value.text ?? "") === (fb.text ?? "")
  )
})
const choices = computed(
  () => q.value.kind === "choice" || q.value.kind === "truefalse",
)
/** Each option shown with its original index, which is what an answer sends. */
const shown = computed(() => {
  const order = props.options?.length
    ? props.options.filter((i) => i >= 0 && i < q.value.choices.length)
    : q.value.choices.map((_, i) => i)
  return order.map((i) => ({ i, text: q.value.choices[i]! }))
})

const LETTERS = "ABCDEF"
function state(i: number) {
  const fb = f.value
  if (open.value) return sel.value.choice === i ? "chosen" : undefined
  if (!fb) return undefined
  if (fb.held || fb.pick) return i === fb.choice ? "picked" : undefined
  if (i === fb.answer) return "right"
  if (i === fb.choice) return "wrong"
}
function choose(i: number) {
  if (open.value && !props.busy) emit("pick", { choice: i })
}
/** A word from the bank is the answer as text, so it is saved and checked like a typed one. */
function word(w: string) {
  if (open.value && !props.busy) emit("pick", { text: w })
}
const same = (a: string | undefined, b: string) =>
  (a ?? "").trim().toLowerCase() === b.trim().toLowerCase()
const isUsed = (w: string) => !!props.used?.some((u) => same(u, w))
const typed = (e: Event) =>
  emit("pick", {
    text: (e.target as HTMLInputElement | HTMLTextAreaElement).value,
  })

/** The options are a radio group: the arrow keys move the pick, as they move a radio's. */
function onKey(e: KeyboardEvent) {
  if (!open.value || props.busy) return
  const step =
    e.key === "ArrowDown" || e.key === "ArrowRight"
      ? 1
      : e.key === "ArrowUp" || e.key === "ArrowLeft"
        ? -1
        : 0
  if (!step) return
  e.preventDefault()
  const list = shown.value
  const from = list.findIndex((c) => c.i === sel.value.choice)
  const to =
    from < 0
      ? step > 0
        ? 0
        : list.length - 1
      : (from + step + list.length) % list.length
  emit("pick", { choice: list[to]!.i })
  const group = e.currentTarget as HTMLElement
  ;(group.querySelectorAll(".option")[to] as HTMLElement | undefined)?.focus()
}
/** Which option the Tab key lands on: the picked one, or the first with no pick. */
const tabStop = (i: number, at: number) =>
  sel.value.choice == null
    ? at === 0
      ? 0
      : -1
    : sel.value.choice === i
      ? 0
      : -1

const typedState = computed(() => {
  const fb = g.value
  if (!fb || fb.skipped || fb.pending) return undefined
  return fb.score >= fb.points ? "right" : fb.score > 0 ? "partial" : "wrong"
})

const hint = computed(() => {
  const { topic, page } = q.value
  if (!topic) return null
  return page
    ? `Look at “${topic}” on page ${page} of the material.`
    : `Look at “${topic}” in the material.`
})

// The hint's toggle names what it will do: show, or hide what is showing.
const hintOpen = ref(false)
watch(
  () => q.value.id,
  () => (hintOpen.value = false),
)

const glue = (t: string | null | undefined) =>
  (t ?? "").replace(
    /(\d)\s+(?=°|%|(?:kg|g|mg|km|cm|mm|m|mL|L|s|min|h)\b)/g,
    "$1\u00a0",
  )

const points = (n: number) => `${n} ${n === 1 ? "point" : "points"}`

const reveal = ref(false)
const judged = (x: Given | undefined) => !!x && !x.pick
watch(f, (now, before) => {
  if (judged(now) && !judged(before)) reveal.value = true
})
watch(
  () => q.value.id,
  () => (reveal.value = false),
)
</script>

<template>
  <article
    class="item"
    :data-reveal="reveal || undefined"
    :style="{ '--n': choices ? shown.length : 0 }"
  >
    <div class="ask">
      <p class="meta">
        <span>{{ KIND_LABEL[q.kind] }} · {{ points(q.points) }}</span>
        <span v-if="f?.held || savedPick" class="got">Answer saved</span>
        <span v-else-if="g?.skipped" class="got">Not answered</span>
        <span v-else-if="g?.pending" class="got">Not scored yet</span>
        <span
          v-else-if="g"
          class="got"
          :data-state="g.correct ? 'right' : g.score > 0 ? 'partial' : 'wrong'"
        >
          {{ g.score }} / {{ g.points }}
        </span>
      </p>
      <h2 class="prompt">
        <span class="n">{{ number }}.</span>
        <span>{{ q.prompt }}</span>
      </h2>
      <figure v-if="q.image" class="pic">
        <img
          :src="`/api/illustrations/file/${q.image}`"
          :alt="q.imageAlt || ''"
          loading="lazy"
        />
        <figcaption v-if="q.imageCredit">
          <a
            v-if="q.imageCredit.url"
            :href="q.imageCredit.url"
            target="_blank"
            rel="noopener"
            >{{ q.imageCredit.text }}</a
          >
          <template v-else>{{ q.imageCredit.text }}</template>
        </figcaption>
      </figure>
    </div>

    <!-- Multiple choice and true or false: a tap picks, and picks again. -->
    <ul
      v-if="choices"
      class="options"
      stack
      :role="open ? 'radiogroup' : undefined"
      :aria-label="open ? 'Your answer' : undefined"
      @keydown="onKey"
    >
      <li
        v-for="(c, at) in shown"
        :key="c.i"
        :style="{ '--i': at }"
        :role="open ? 'presentation' : undefined"
      >
        <button
          type="button"
          class="option"
          :role="open ? 'radio' : undefined"
          :aria-checked="open ? sel.choice === c.i : undefined"
          :tabindex="open ? tabStop(c.i, at) : undefined"
          :data-state="state(c.i)"
          :data-picked="(!open && f && c.i === f.choice) || undefined"
          :disabled="!open || busy"
          @click="choose(c.i)"
        >
          <b v-if="q.kind === 'choice'" class="letter">{{ LETTERS[at] }}.</b>
          <span class="body">
            <span>
              {{ c.text }}
              <em v-if="state(c.i) === 'right'">(correct answer)</em>
              <em v-else-if="state(c.i) === 'wrong' || state(c.i) === 'picked'"
                >(your answer)</em
              >
            </span>
            <small v-if="g && g.reasons[c.i]">{{ glue(g.reasons[c.i]) }}</small>
          </span>
          <span v-if="open" class="tick" aria-hidden="true" />
        </button>
      </li>
    </ul>

    <!-- Identification and essay: typed here, sent by the page's button. -->
    <div v-else class="typed">
      <figure v-if="set?.style === 'crossword' && grid" class="cross">
        <figcaption>{{ set.title || "Crossword" }}</figcaption>
        <CrosswordGrid :rows="set.rows" :cols="set.cols" :entries="grid" />
      </figure>

      <!-- A word bank: the answer is one of its words, picked instead of typed. -->
      <div v-if="open && set?.style === 'bank'" class="bank">
        <p :id="`bank-${q.id}`" class="bank-title">
          {{ set.title || "Word bank" }}
        </p>
        <ul role="radiogroup" :aria-labelledby="`bank-${q.id}`">
          <li v-for="w in set.words" :key="w">
            <button
              type="button"
              role="radio"
              :aria-checked="same(sel.text, w)"
              :data-used="isUsed(w) || undefined"
              :disabled="busy"
              @click="word(w)"
            >
              {{ w }}
            </button>
          </li>
        </ul>
        <p class="note">
          Choose the word that fits. A crossed-out word is already used on
          another question, and can still be chosen.
        </p>
      </div>

      <form v-else-if="open" class="write" @submit.prevent="emit('confirm')">
        <label :for="`answer-${q.id}`" class="sr-only">Your answer</label>
        <p v-if="q.entry" class="clue">
          {{ q.entry.number }}
          {{ q.entry.dir === "across" ? "Across" : "Down" }},
          {{ q.entry.length }} letters
        </p>
        <input
          v-if="q.kind === 'identify'"
          :id="`answer-${q.id}`"
          :value="sel.text ?? ''"
          field
          autocomplete="off"
          placeholder="Your answer"
          maxlength="300"
          :disabled="busy"
          @input="typed"
        />
        <textarea
          v-else
          :id="`answer-${q.id}`"
          :value="sel.text ?? ''"
          field
          rows="6"
          placeholder="Write your answer"
          maxlength="8000"
          :disabled="busy"
          @input="typed"
        />
        <p class="note">
          <template v-if="q.entry">
            Capital letters and spaces do not count. Every letter has to match
            the answer.
          </template>
          <template v-else-if="q.kind === 'identify' && aiCheck">
            Capital letters, spacing and numbers written as words do not count
            against you. A close answer goes to the AI to check.
          </template>
          <template v-else-if="q.kind === 'identify'">
            Capital letters, spacing and numbers written as words do not count
            against you. Spelling has to match the answer key.
          </template>
          <template v-else-if="aiEssay">
            The AI scores essays against the quiz maker’s rubric. It can be
            wrong, and the quiz maker can change your score.
          </template>
          <template v-else>
            The quiz maker scores this essay. Its points come later.
          </template>
        </p>
      </form>

      <template v-else-if="f">
        <p class="given" :data-state="typedState">
          {{ f.skipped ? "Not answered" : f.text || "(empty)" }}
        </p>
        <template v-if="g">
          <p v-if="q.kind === 'identify' && g.accepted.length" class="accepted">
            Accepted: {{ g.accepted.join(", ") }}
          </p>
          <p v-if="g.verdict" class="verdict">
            <span v-if="g.byAi" class="ai" title="Checked by the AI">AI</span>
            {{ g.verdict }}
          </p>
          <p v-if="g.byAi" class="note">
            The AI can be wrong. The quiz maker sees this verdict and can change
            your score.
          </p>
          <p v-if="g.pending" class="note waiting">
            The quiz maker scores this essay. Its points come later.
          </p>
        </template>
        <p v-else class="note">The quiz maker releases the results later.</p>
      </template>
    </div>
    <p v-if="choices && f?.held" class="note">
      The quiz maker releases the results later.
    </p>

    <!-- Before answering, where to look; after, why, and the sentence itself. -->
    <details
      v-if="open && hint && showHints"
      class="hint"
      :open="hintOpen"
      @toggle="hintOpen = ($event.target as HTMLDetailsElement).open"
    >
      <summary>
        {{ hintOpen ? "Hide hint" : "Show hint" }}
        <Icon name="chevron" :size="16" />
      </summary>
      <p>{{ hint }}</p>
    </details>
    <div v-if="g && (g.explain || g.quote)" class="why">
      <p v-if="g.explain">{{ glue(g.explain) }}</p>
      <blockquote v-if="g.quote">
        <p>“{{ glue(g.quote) }}”</p>
        <cite>From the material{{ g.page ? `, page ${g.page}` : "" }}</cite>
      </blockquote>
    </div>
  </article>
</template>

<style scoped>
.item {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ask {
  padding: 14px 16px;
  border: 1px solid color-mix(in srgb, var(--ink) 14%, transparent);
  border-radius: var(--radius-2xl);
  background: var(--surface);
}
.meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin: 0 0 6px;
  font-size: 13px;
  color: var(--muted);
}
.got {
  font-weight: 650;
  color: color-mix(in srgb, var(--ink) 70%, transparent);

  &[data-state="right"] {
    color: var(--good);
  }
  &[data-state="wrong"] {
    color: var(--bad);
  }
}
/* The question's picture, under the prompt, its credit in small type. */
.pic {
  margin: 12px 0 0;

  img {
    display: block;
    max-width: 100%;
    max-height: 360px;
    border-radius: var(--radius-lg);
    background: var(--sunken);
  }
  figcaption {
    margin-top: 4px;
    font-size: 12px;
    color: var(--muted);

    a {
      color: inherit;
    }
  }
}
.prompt {
  display: flex;
  gap: 6px;
  margin: 0;
  font: 500 17px/1.45 var(--font);
}
.n {
  flex: none;
  font-variant-numeric: tabular-nums;
}

.option {
  display: flex;
  gap: 14px;
  width: 100%;
  min-height: 52px;
  padding: 14px 16px;
  border: 1px solid transparent;
  border-radius: inherit;
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    background var(--fast) var(--ease),
    border-color var(--fast) var(--ease),
    box-shadow var(--fast) var(--ease),
    scale 100ms var(--ease);

  &:hover:not(:disabled) {
    border-color: color-mix(
      in srgb,
      var(--accent-text, var(--accent)) 45%,
      transparent
    );
    background: color-mix(in srgb, var(--accent) 5%, var(--surface));
  }
  /* Pressed: the tile gives under the finger, so the tap is seen to land. */
  &:active:not(:disabled) {
    scale: 0.98;
  }
  /* Inside the tile: the option group's `contain: content` clips anything outside. */
  &:focus-visible {
    outline: 2px solid var(--accent-text, var(--accent));
    outline-offset: -3px;
  }
  &:disabled {
    cursor: default;
  }
  &[data-state="chosen"],
  &[data-state="chosen"]:hover:not(:disabled) {
    border-color: var(--accent-text, var(--accent));
    background: color-mix(in srgb, var(--accent) 8%, var(--surface));
    box-shadow: inset 0 0 0 1px var(--accent-text, var(--accent));
  }
  &[data-state="right"] {
    background: var(--good-soft);
  }
  /* A wrong pick reads first, the answer 80 ms after: two facts in order. */
  &[data-state="right"]:not([data-picked]) {
    transition-delay: 80ms;
  }
  &[data-state="wrong"] {
    background: var(--bad-soft);
  }
  /* Held results: the pick is marked, in the accent, and nothing is judged. */
  &[data-state="picked"] {
    border-color: color-mix(
      in srgb,
      var(--accent-text, var(--accent)) 45%,
      transparent
    );
    background: color-mix(in srgb, var(--accent) 10%, var(--surface));
  }
}
[data-state="picked"] em {
  color: var(--accent-text, var(--accent));
}
.options > li:first-child .option {
  border-top-left-radius: var(--radius-2xl);
  border-top-right-radius: var(--radius-2xl);
}
.options > li:last-child .option {
  border-bottom-left-radius: var(--radius-2xl);
  border-bottom-right-radius: var(--radius-2xl);
}
.tick {
  flex: none;
  align-self: center;
  width: 20px;
  height: 20px;
  margin-left: auto;
  border: 2px solid color-mix(in srgb, var(--ink) 45%, transparent);
  border-radius: 50%;
  transition: border-color var(--fast) var(--ease);
}
[data-state="chosen"] .tick {
  border-color: var(--accent-text, var(--accent));
  background: radial-gradient(
    circle,
    var(--accent-text, var(--accent)) 0 5px,
    transparent 5.5px
  );
}
.letter {
  flex: none;
  width: 1.4em;
}
.body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  gap: 2px;

  em {
    font-style: normal;
    font-weight: 700;
  }
  small {
    font-size: 13px;
    line-height: 1.4;
    color: var(--muted);
  }
}
[data-state="right"] em {
  color: color-mix(in srgb, var(--good) 80%, black);
}
[data-state="wrong"] {
  .letter,
  .body > span {
    color: var(--bad);
  }
}

.bank {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--surface);

  .bank-title {
    margin: 0;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--muted);
  }
  ul {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  button {
    min-height: 44px;
    padding: 0 16px;
    border: 1px solid var(--line);
    border-radius: var(--radius-full);
    background: var(--surface);
    color: inherit;
    font: inherit;
    font-weight: 500;
    cursor: pointer;
    transition:
      background 0.15s,
      border-color 0.15s,
      transform 0.1s;

    &:hover {
      border-color: var(--accent, var(--good));
    }
    &:active {
      transform: scale(0.97);
    }
    &[data-used] {
      color: var(--muted);
      text-decoration: line-through;
    }
    &[aria-checked="true"] {
      border-color: var(--accent, var(--good));
      background: color-mix(
        in srgb,
        var(--accent, var(--good)) 14%,
        var(--surface)
      );
      color: inherit;
      text-decoration: none;
      font-weight: 600;
    }
  }
}
.cross {
  display: grid;
  gap: 8px;
  justify-items: center;
  margin: 0 0 12px;

  figcaption {
    justify-self: start;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--muted);
  }
}
.clue {
  margin: 0 0 6px;
  font-size: 0.875rem;
  font-weight: 600;
}

.typed {
  display: flex;
  flex-direction: column;
  gap: 8px;

  p {
    margin: 0;
  }
}
.write {
  display: flex;
  flex-direction: column;
  gap: 10px;

  textarea {
    min-height: 140px;
    padding: 10px 12px;
    resize: vertical;
    line-height: 1.5;
  }
}
.given {
  padding: 12px 14px;
  border-radius: var(--radius-lg);
  background: var(--surface);
  white-space: pre-wrap;

  &[data-state="right"] {
    background: var(--good-soft);
  }
  &[data-state="partial"] {
    background: color-mix(in srgb, var(--warn) 14%, var(--surface));
  }
  &[data-state="wrong"] {
    background: var(--bad-soft);
  }
}
.accepted {
  font-size: 14px;
  color: var(--muted);
}
.verdict {
  font-size: 15px;
}
.ai {
  display: inline-block;
  margin-right: 4px;
  padding: 0 6px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--warn) 18%, var(--surface));
  color: color-mix(in srgb, var(--warn) 80%, black);
  font-size: 11px;
  font-weight: 700;
  vertical-align: 1px;
}
.note {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}

.hint {
  font-size: 14px;

  summary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    padding: 0;
    font-weight: 650;
    color: var(--accent-text, var(--accent));
    cursor: pointer;
    list-style: none;

    &::-webkit-details-marker {
      display: none;
    }
  }
  &[open] summary svg {
    rotate: 180deg;
  }
  p {
    margin: 4px 0 0;
    padding: 10px 14px;
    border-radius: var(--radius-2xl);
    background: color-mix(in srgb, var(--accent) 7%, var(--surface));
  }
}

.why {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border-radius: var(--radius-2xl);
  background: color-mix(in srgb, var(--accent) 6%, var(--surface));
  font-size: 14px;
  line-height: 1.5;

  p {
    margin: 0;
  }
  blockquote {
    margin: 0;
    padding-left: 12px;
    border-left: 3px solid color-mix(in srgb, var(--accent) 45%, transparent);
  }
  cite {
    display: block;
    margin-top: 4px;
    font-size: 12px;
    font-style: normal;
    color: var(--muted);
  }
}

.item[data-reveal] {
  .got {
    animation: fade-in var(--fast) var(--ease) both;
  }
  .body small,
  .given,
  .accepted,
  .verdict,
  .why > p,
  .why blockquote {
    animation: rise-in 200ms var(--ease-emphasized-decelerate) both;
  }
  .body small {
    animation-delay: calc(var(--i, 0) * 40ms);
  }
  .accepted,
  .verdict {
    animation-delay: 40ms;
  }
  .why > p {
    animation-delay: calc(var(--n, 0) * 40ms);
  }
  .why blockquote {
    animation-delay: calc((var(--n, 0) + 1) * 40ms);
  }
}
@keyframes rise-in {
  from {
    opacity: 0;
    translate: 0 8px;
  }
}
@keyframes fade-in {
  from {
    opacity: 0;
  }
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
