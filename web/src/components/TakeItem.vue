<script setup lang="ts">
import { computed, ref, watch } from "vue"
import Icon from "./Icon.vue"
import { KIND_LABEL } from "../composables/quizzes"
import type { Feedback, Given, PublicQuestion } from "../composables/take"

/**
 * One question on the respondent's side, from the QuizApp design: the prompt
 * in its own card, the options below. Before an answer it takes one (a tap
 * on an option, or typed text) and offers a hint naming where in the
 * material to look. After, it shows the feedback: the right option green,
 * a wrong pick red, why each option is right or wrong, and the sentence in
 * the material the answer comes from.
 *
 * While the quiz maker holds the results, an answer is only marked as given:
 * no right or wrong, no reasons. An essay the quiz maker scores by hand
 * (essay checking off) says so until it has a score.
 */
const props = withDefaults(
  defineProps<{
    question: PublicQuestion
    number: number
    feedback?: Given
    /** An answer is being graded. */
    busy?: boolean
    /** The original option indices in the order shown; the quiz's own order without it. */
    options?: number[]
    /** The quiz maker holds the results back. */
    held?: boolean
    /** Off, the "Show hint" control is not offered (a graded quiz). */
    showHints?: boolean
    aiCheck?: boolean
    aiEssay?: boolean
  }>(),
  { showHints: true, aiCheck: true, aiEssay: true },
)
const emit = defineEmits<{
  answer: [given: { choice?: number; text?: string }]
}>()

const q = computed(() => props.question)
const f = computed(() => props.feedback)
/** The feedback, when the answer came back graded rather than held. */
const g = computed<Feedback | undefined>(() =>
  f.value && !f.value.held ? f.value : undefined,
)
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

const text = ref("")
watch(
  () => q.value.id,
  () => (text.value = ""),
)

const LETTERS = "ABCDEF"
function state(i: number) {
  const fb = f.value
  if (!fb) return undefined
  if (fb.held) return i === fb.choice ? "picked" : undefined
  if (i === fb.answer) return "right"
  if (i === fb.choice) return "wrong"
}
function pick(i: number) {
  if (!f.value && !props.busy) emit("answer", { choice: i })
}
function submit() {
  if (text.value.trim() && !props.busy) emit("answer", { text: text.value })
}

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

/**
 * A number and its unit kept on one line ("-38.8 °C", "29.8 %"): the AI's
 * text puts an ordinary space between them, where a line may break.
 */
const glue = (t: string | null | undefined) =>
  (t ?? "").replace(
    /(\d)\s+(?=°|%|(?:kg|g|mg|km|cm|mm|m|mL|L|s|min|h)\b)/g,
    "$1\u00a0",
  )

const points = (n: number) => `${n} ${n === 1 ? "point" : "points"}`

/**
 * The feedback arrived while this question was on screen, as against a
 * question mounted already graded (the review, or Back to an answered one).
 * Only the first case is a reveal, and only a reveal animates.
 */
const reveal = ref(false)
watch(f, (now, before) => {
  if (now && !before) reveal.value = true
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
        <span v-if="f?.held" class="got">Answer saved</span>
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

    <!-- Multiple choice and true or false: a tap answers. -->
    <ul v-if="choices" class="options" stack>
      <li v-for="(c, at) in shown" :key="c.i" :style="{ '--i': at }">
        <button
          type="button"
          class="option"
          :data-state="state(c.i)"
          :data-picked="(f && c.i === f.choice) || undefined"
          :disabled="!!f || busy"
          :aria-label="
            f
              ? undefined
              : `Answer ${q.kind === 'choice' ? LETTERS[at] + ': ' : ''}${c.text}`
          "
          @click="pick(c.i)"
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
        </button>
      </li>
    </ul>

    <!-- Identification and essay: typed, then checked. -->
    <div v-else class="typed">
      <form v-if="!f" class="write" @submit.prevent="submit">
        <label :for="`answer-${q.id}`" class="sr-only">Your answer</label>
        <input
          v-if="q.kind === 'identify'"
          :id="`answer-${q.id}`"
          v-model="text"
          field
          autocomplete="off"
          placeholder="Your answer"
          maxlength="300"
          :disabled="busy"
        />
        <textarea
          v-else
          :id="`answer-${q.id}`"
          v-model="text"
          field
          rows="6"
          placeholder="Write your answer"
          maxlength="8000"
          :disabled="busy"
        />
        <button btn="primary" :disabled="busy || !text.trim()">
          {{
            busy
              ? held || (q.kind === "essay" && !aiEssay)
                ? "Saving…"
                : "Checking…"
              : q.kind === "essay" || held
                ? "Submit answer"
                : "Check answer"
          }}
        </button>
        <p class="note">
          <template v-if="q.kind === 'identify' && aiCheck">
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

      <template v-else>
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
      v-if="!f && hint && showHints"
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
    scale 100ms var(--ease);

  &:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
    background: color-mix(in srgb, var(--accent) 5%, var(--surface));
  }
  /* Pressed: the tile gives under the finger, so the tap is seen to land. */
  &:active:not(:disabled) {
    scale: 0.98;
  }
  /* Inside the tile: the option group's `contain: content` clips anything outside. */
  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -3px;
  }
  &:disabled {
    cursor: default;
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
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
    background: color-mix(in srgb, var(--accent) 10%, var(--surface));
  }
}
[data-state="picked"] em {
  color: var(--accent);
}
.letter {
  flex: none;
  width: 1.4em;
}
.body {
  display: flex;
  flex-direction: column;
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
  button {
    align-self: flex-start;
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
    color: var(--accent);
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

/* The reveal, in reading order: the verdict's chip, then why each option is
   right or wrong (one after another, down the list), then the explanation,
   then the sentence it rests on. Each rises 8px into place; a skipped
   animation leaves the element where its own rules put it. */
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
