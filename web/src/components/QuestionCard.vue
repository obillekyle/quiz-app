<script setup lang="ts">
import { computed, ref } from "vue"
import Icon from "./Icon.vue"
import { api } from "../composables/api"
import {
  BLOOM,
  KINDS,
  KIND_LABEL,
  type AnswerStyle,
  type Kind,
  type Question,
} from "../composables/quizzes"

const q = defineModel<Question>({ required: true })
const props = defineProps<{
  index: number
  total: number
  language: "en" | "fil"
  quizId: number
}>()
defineEmits<{
  remove: []
  up: []
  down: []
  /** How this identification question is answered: typed, from the word bank, or in the crossword. */
  answered: [style: AnswerStyle]
  /** The word bank's extra words, which every question in the bank shares. */
  extra: [words: string[]]
}>()

const words = (text: string) =>
  text
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean)

const LETTERS = "ABCDEF"

// ---- the illustration -----------------------------------------------------------
// A picture above the question: the teacher's own file, a figure cropped out
// of the module's page by the AI, or one from Wikimedia Commons for a search
// the AI names (Kyle, 23:45). It is saved with the question like any field.
type Credit = {
  from: "upload" | "module" | "wikimedia"
  text: string
  url: string | null
}
type Candidate = {
  kind: "module" | "wikimedia"
  preview: string
  alt: string
  credit: Credit
  ref: string
}
type Illustration = {
  image: string
  imageAlt: string
  imageCredit: Credit | null
}
const pic = computed(() => q.value as Question & Partial<Illustration>)
const picUrl = computed(() =>
  pic.value.image ? `/api/illustrations/file/${pic.value.image}` : null,
)

const picking = ref(false)
const finding = ref(false)
const candidates = ref<Candidate[] | null>(null)
const search = ref("")
const picError = ref("")
const picFile = ref<HTMLInputElement>()

function cancelPick() {
  picking.value = false
  candidates.value = null
  picError.value = ""
}
function setAlt(e: Event) {
  q.value = {
    ...q.value,
    imageAlt: (e.target as HTMLInputElement).value,
  } as Question
}

function setPicture(p: Illustration | null) {
  q.value = {
    ...q.value,
    image: p?.image ?? null,
    imageAlt: p?.imageAlt ?? "",
    imageCredit: p?.imageCredit ?? null,
  } as Question
  picking.value = false
  candidates.value = null
}

async function findPictures() {
  if (!q.value.prompt.trim()) {
    picError.value = "Write the question first, then find a picture for it."
    return
  }
  finding.value = true
  picError.value = ""
  try {
    const r = await api<{ candidates: Candidate[]; search: string }>(
      "/illustrations/find",
      {
        method: "POST",
        body: {
          quizId: props.quizId,
          question: {
            prompt: q.value.prompt,
            topic: q.value.topic,
            quote: q.value.quote,
            file: q.value.file,
            page: q.value.page,
            answer:
              q.value.answer != null
                ? (q.value.choices[q.value.answer]?.text ?? null)
                : (q.value.accepted[0] ?? null),
          },
        },
      },
    )
    candidates.value = r.candidates
    search.value = r.search
    if (!r.candidates.length)
      picError.value = "Nothing fitting was found. Upload a picture instead."
  } catch (e) {
    picError.value = e instanceof Error ? e.message : String(e)
  } finally {
    finding.value = false
  }
}

async function attach(c: Candidate) {
  finding.value = true
  picError.value = ""
  try {
    setPicture(
      await api<Illustration>("/illustrations/attach", {
        method: "POST",
        body: { quizId: props.quizId, candidate: c },
      }),
    )
  } catch (e) {
    picError.value = e instanceof Error ? e.message : String(e)
  } finally {
    finding.value = false
  }
}

async function uploadPicture(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  finding.value = true
  picError.value = ""
  try {
    const form = new FormData()
    form.append("quizId", String(props.quizId))
    form.append("file", file)
    const body = await api<Illustration>("/illustrations/upload", {
      body: form,
    })
    setPicture({
      ...body,
      imageAlt: body.imageAlt || file.name.replace(/\.[a-z0-9]+$/i, ""),
    })
  } catch (err) {
    picError.value = err instanceof Error ? err.message : String(err)
  } finally {
    finding.value = false
    ;(e.target as HTMLInputElement).value = ""
  }
}

/** The quote as loaded: once it is edited, its check waits for the next save. */
const savedQuote = q.value.quote

const check = computed(() =>
  q.value.quote !== savedQuote ? "pending" : (q.value.check ?? "none"),
)
const CHECK_TEXT: Record<string, string> = {
  found: "Found in the file",
  missing: "Not found in the file",
  photo: "From a photo: check it by eye",
  none: "No material: check it yourself",
  pending: "Checked against the file when you save",
}

/** Changing the kind keeps what still fits and fills in the rest. */
function setKind(kind: Kind) {
  const old = q.value
  if (kind === old.kind) return
  const right =
    old.answer != null ? old.choices[old.answer]?.text : old.accepted[0]
  const next: Question = { ...old, kind }
  if (kind === "choice") {
    const keep = old.kind === "choice" ? old.choices : []
    next.choices = [
      ...keep,
      ...[0, 1, 2, 3].map(() => ({ text: "", why: "" })),
    ].slice(0, Math.max(4, keep.length))
    if (old.kind !== "choice" && right)
      next.choices[0] = { text: right, why: "" }
    next.answer = old.kind === "choice" ? old.answer : 0
    next.points = 1
  } else if (kind === "truefalse") {
    next.choices =
      props.language === "fil"
        ? [
            { text: "Tama", why: "" },
            { text: "Mali", why: "" },
          ]
        : [
            { text: "True", why: "" },
            { text: "False", why: "" },
          ]
    next.answer = 0
    next.points = 1
  } else if (kind === "identify") {
    next.choices = []
    next.answer = null
    next.accepted = right ? [right] : []
    next.points = 1
  } else {
    next.choices = []
    next.answer = null
    next.rubric = old.rubric ?? ""
    next.points = Math.max(old.points, 5)
  }
  if (kind !== "essay") next.rubric = null
  if (kind !== "identify") next.accepted = []
  q.value = next
}

function addOption() {
  q.value.choices.push({ text: "", why: "" })
}
function removeOption(i: number) {
  q.value.choices.splice(i, 1)
  if (q.value.answer === i) q.value.answer = 0
  else if (q.value.answer != null && q.value.answer > i) q.value.answer--
}

const draftAnswer = ref("")
function addAccepted() {
  const a = draftAnswer.value.trim()
  if (a && !q.value.accepted.includes(a)) q.value.accepted.push(a)
  draftAnswer.value = ""
}
</script>

<template>
  <article class="qcard" :data-check="check">
    <header>
      <span class="num">{{ index + 1 }}</span>
      <select
        :value="q.kind"
        aria-label="Type of question"
        @change="setKind(($event.target as HTMLSelectElement).value as Kind)"
      >
        <option v-for="k in KINDS" :key="k" :value="k">
          {{ KIND_LABEL[k] }}
        </option>
      </select>
      <select
        v-model="q.bloom"
        class="bloom"
        aria-label="Level of thinking (Bloom)"
        title="Level of thinking (Bloom)"
      >
        <option v-for="b in BLOOM" :key="b" :value="b">
          {{ b[0]!.toUpperCase() + b.slice(1) }}
        </option>
      </select>
      <label class="points" title="Points">
        <input
          v-model.number="q.points"
          type="number"
          min="1"
          max="20"
          aria-label="Points"
        />
        <span>{{ q.points === 1 ? "pt" : "pts" }}</span>
      </label>
      <span class="actions">
        <button
          class="icon"
          :disabled="index === 0"
          aria-label="Move up"
          title="Move up"
          @click="$emit('up')"
        >
          <Icon name="up" :size="18" />
        </button>
        <button
          class="icon down"
          :disabled="index === total - 1"
          aria-label="Move down"
          title="Move down"
          @click="$emit('down')"
        >
          <Icon name="down" :size="18" />
        </button>
        <button
          class="icon danger"
          aria-label="Delete question"
          title="Delete question"
          @click="$emit('remove')"
        >
          <Icon name="delete" :size="18" />
        </button>
      </span>
    </header>

    <textarea
      v-model="q.prompt"
      class="prompt"
      rows="1"
      placeholder="Question"
      aria-label="Question"
    />

    <!-- The illustration: shown with its credit, or offered. -->
    <figure v-if="picUrl" class="pic">
      <img :src="picUrl" :alt="pic.imageAlt || ''" />
      <figcaption>
        <input
          :value="pic.imageAlt"
          placeholder="What the picture shows, for screen readers"
          aria-label="Picture description"
          @input="setAlt"
        />
        <span v-if="pic.imageCredit" class="credit">
          <a
            v-if="pic.imageCredit.url"
            :href="pic.imageCredit.url"
            target="_blank"
            rel="noopener"
            >{{ pic.imageCredit.text }}</a
          >
          <template v-else>{{ pic.imageCredit.text }}</template>
        </span>
        <button type="button" class="add" @click="setPicture(null)">
          <Icon name="close" :size="16" /> Remove picture
        </button>
      </figcaption>
    </figure>
    <div v-else class="pic-add">
      <template v-if="!picking">
        <button type="button" class="add" @click="picking = true">
          <Icon name="image" :size="16" /> Add a picture
        </button>
      </template>
      <template v-else>
        <div class="pic-actions">
          <button
            type="button"
            class="add"
            :disabled="finding"
            @click="findPictures"
          >
            <Icon name="sparkle" :size="16" />
            {{ finding ? "Looking…" : "Find one" }}
          </button>
          <button
            type="button"
            class="add"
            :disabled="finding"
            @click="picFile?.click()"
          >
            <Icon name="download" :size="16" /> Upload
          </button>
          <button type="button" class="add quiet" @click="cancelPick">
            Cancel
          </button>
          <input
            ref="picFile"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            @change="uploadPicture"
          />
        </div>
        <p v-if="!candidates && !picError" class="aside">
          Find one looks for a figure on the module's page this question comes
          from, then for a picture on Wikimedia Commons. A Commons picture is
          shown with its author and license.
        </p>
        <p v-if="picError" class="aside bad" role="alert">{{ picError }}</p>
        <ul
          v-if="candidates?.length"
          class="candidates"
          aria-label="Pictures to choose from"
        >
          <li v-for="c in candidates" :key="c.ref">
            <button
              type="button"
              :disabled="finding"
              :title="c.alt"
              @click="attach(c)"
            >
              <img :src="c.preview" :alt="c.alt" loading="lazy" />
              <span>{{
                c.kind === "module"
                  ? c.credit.text
                  : c.credit.text.split(",")[0]
              }}</span>
            </button>
          </li>
        </ul>
        <p v-if="candidates?.length" class="aside">
          From the module's page, then Wikimedia Commons for "{{ search }}".
          Pick one, or upload your own.
        </p>
      </template>
    </div>

    <!-- Multiple choice and true or false: the right one is marked; every option says why. -->
    <ol v-if="q.kind === 'choice' || q.kind === 'truefalse'" class="options">
      <li
        v-for="(c, i) in q.choices"
        :key="i"
        :data-right="q.answer === i || undefined"
      >
        <button
          class="mark"
          :aria-pressed="q.answer === i"
          :aria-label="`Mark ${LETTERS[i]} as the correct answer`"
          :title="
            q.answer === i ? 'The correct answer' : 'Mark as the correct answer'
          "
          @click="q.answer = i"
        >
          <Icon v-if="q.answer === i" name="check" :size="16" />
        </button>
        <b>{{ LETTERS[i] }}.</b>
        <div class="fields">
          <input
            v-model="c.text"
            :readonly="q.kind === 'truefalse'"
            placeholder="Option"
            :aria-label="`Option ${LETTERS[i]}`"
          />
          <textarea
            v-model="c.why"
            rows="1"
            class="why"
            :placeholder="
              q.answer === i ? 'Why this is right' : 'Why this is wrong'
            "
            :aria-label="`Why option ${LETTERS[i]} is right or wrong`"
          />
        </div>
        <button
          v-if="q.kind === 'choice' && q.choices.length > 2"
          class="icon"
          :aria-label="`Remove option ${LETTERS[i]}`"
          title="Remove option"
          @click="removeOption(i)"
        >
          <Icon name="close" :size="14" />
        </button>
      </li>
    </ol>
    <button
      v-if="q.kind === 'choice' && q.choices.length < 6"
      class="add"
      @click="addOption"
    >
      <Icon name="plus" :size="16" /> Add another option
    </button>

    <!-- Identification: what counts as right. -->
    <div v-if="q.kind === 'identify'" class="accepted">
      <span class="label">Accepted answers</span>
      <ul>
        <li v-for="(a, i) in q.accepted" :key="a">
          {{ a }}
          <button :aria-label="`Remove ${a}`" @click="q.accepted.splice(i, 1)">
            <Icon name="close" :size="12" />
          </button>
        </li>
        <li class="input">
          <input
            v-model="draftAnswer"
            placeholder="Add an answer, then Enter"
            aria-label="Add an accepted answer"
            @keydown.enter.prevent="addAccepted"
            @blur="addAccepted"
          />
        </li>
      </ul>
      <p v-if="!q.itemSet" class="aside">
        The AI checks typed answers, so capitalization, small spelling slips and
        numbers written as words still count.
      </p>

      <label class="answered">
        <span class="label">Answered</span>
        <select
          :value="q.itemSet?.style ?? 'typed'"
          @change="
            $emit(
              'answered',
              ($event.target as HTMLSelectElement).value as AnswerStyle,
            )
          "
        >
          <option value="typed">Typed</option>
          <option value="bank">From the word bank</option>
          <option value="crossword">In the crossword</option>
        </select>
      </label>
      <template v-if="q.itemSet?.style === 'bank'">
        <label class="answered">
          <span class="label">Extra words in the bank</span>
          <input
            :value="q.itemSet.extra.join(', ')"
            placeholder="Words that fit no question, separated by commas"
            @change="
              $emit('extra', words(($event.target as HTMLInputElement).value))
            "
          />
        </label>
        <p class="aside">
          The bank holds the first accepted answer of every question in it, plus
          the extra words, in alphabetical order. A pick is checked against the
          key, with no AI.
        </p>
      </template>
      <p v-else-if="q.itemSet?.style === 'crossword'" class="aside">
        The first accepted answer goes in the grid and this question is its
        clue. A word that crosses no other word is asked as a typed question.
      </p>
    </div>

    <!-- Essay: the rubric the AI scores against, and the notice. -->
    <div v-if="q.kind === 'essay'" class="essay">
      <span class="label">What a full answer includes (rubric)</span>
      <textarea
        v-model="q.rubric"
        rows="3"
        placeholder="List what earns points, with the points for each."
        aria-label="Rubric"
      />
      <p class="notice" role="note">
        <b>Scored by the AI.</b> AI verdicts can be wrong. Read the scores in
        Responses before you rely on them, and change any you disagree with.
      </p>
    </div>

    <label class="block">
      <span class="label">Explanation, shown after answering</span>
      <textarea
        v-model="q.explain"
        rows="1"
        class="explain"
        placeholder="Why the answer is right, in a sentence or two."
      />
    </label>

    <footer class="source">
      <span class="badge" :data-check="check"
        >{{
          check === "found" && q.file
            ? `Found in ${q.file}`
            : CHECK_TEXT[check]
        }}{{ check === "found" && q.page ? `, page ${q.page}` : "" }}</span
      >
      <textarea
        v-model="q.quote"
        class="quote"
        rows="1"
        placeholder="The sentence from the material that supports this question"
        aria-label="Source quote"
      />
      <label class="topic-field">
        <span class="label">Topic</span>
        <input
          v-model="q.topic"
          class="topic"
          placeholder="A heading from the material"
        />
      </label>
    </footer>
  </article>
</template>

<style scoped>
.qcard {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 18px;
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  background: var(--surface);
  transition: box-shadow var(--fast);

  &:focus-within {
    box-shadow: var(--shadow-md);
  }
  &[data-check="missing"] {
    border-color: color-mix(in srgb, var(--bad) 40%, transparent);
  }
}

/* ---- arriving ----
   The draft's cards come one after another, 60 ms apart (the stagger capped
   at eight so a long quiz is not a long wait); a card the chat changed
   flashes its border to the accent and back over 1.2 s, once; a card the
   chat added slides into its place. In each case the card reveals top to
   bottom, 40 ms a part: header, prompt, options, the rest. The attributes
   and `--i` come from the list. */
.qcard[data-rise] {
  --arrive: calc(min(var(--i, 0), 8) * 60ms);
  animation: rise-in 240ms var(--ease-emphasized-decelerate) both;
  animation-delay: var(--arrive);
}
/* The keyframes name only the middle, so the border ends on whatever the
   card's own rules say (a missing quote keeps its red). */
.qcard[data-changed] {
  --arrive: 0ms;
  animation: flash-border 1.2s var(--ease) both;
}
.qcard[data-new] {
  --arrive: 0ms;
  animation: slide-in 240ms var(--ease-emphasized-decelerate) both;
}
.qcard[data-rise] > *,
.qcard[data-changed] > *,
.qcard[data-new] > * {
  animation: part-in 200ms var(--ease-emphasized-decelerate) both;
  animation-delay: calc(var(--arrive, 0ms) + var(--k, 0) * 40ms);
}
.qcard > :nth-child(2) {
  --k: 1;
}
.qcard > :nth-child(3) {
  --k: 2;
}
.qcard > :nth-child(4) {
  --k: 3;
}
.qcard > :nth-child(5) {
  --k: 4;
}
.qcard > :nth-child(6) {
  --k: 5;
}
.qcard > :nth-child(7) {
  --k: 6;
}
.qcard > :nth-child(n + 8) {
  --k: 7;
}
@keyframes rise-in {
  from {
    opacity: 0;
    translate: 0 8px;
  }
}
@keyframes slide-in {
  from {
    opacity: 0;
    translate: 0 24px;
  }
}
@keyframes part-in {
  from {
    opacity: 0;
    translate: 0 6px;
  }
}
@keyframes flash-border {
  15%,
  60% {
    border-color: var(--accent);
  }
}

header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
/* Move and delete at the row's end; on a narrow card, a row of their own. */
.actions {
  display: flex;
  gap: 4px;
  margin-left: auto;
}

.num {
  display: grid;
  place-items: center;
  min-width: 28px;
  height: 28px;
  padding: 0 6px;
  border-radius: var(--radius-md);
  background: var(--accent);
  color: var(--accent-ink);
  font: 650 14px/1 var(--font-heading);
}

select {
  height: 30px;
  padding: 0 28px 0 6px;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background-color: var(--surface);
  font: inherit;
  font-size: 13px;
  color: var(--ink);
  cursor: pointer;
}

.bloom {
  color: color-mix(in srgb, var(--ink) 70%, transparent);
}

.points {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--muted);

  input {
    width: 44px;
    height: 30px;
    padding: 0 4px;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    font: inherit;
    text-align: center;
  }
}

.icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 0;
  padding: 0;
  border-radius: var(--radius-md);
  background: none;
  color: var(--muted);
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--hover);
    color: var(--ink);
  }
  &:disabled {
    opacity: 0.3;
    cursor: default;
  }
  &.danger:hover {
    color: var(--bad);
  }
}

textarea,
input {
  font: inherit;
  color: var(--ink);
}

.prompt {
  field-sizing: content;
  min-height: 28px;
  resize: none;
  padding: 6px 0;
  border: 0;
  border-bottom: 1px solid var(--line);
  outline: none;
  background: none;
  font-size: 17px;
  font-weight: 600;

  &:focus {
    border-bottom-color: var(--accent);
  }
}

/* ---- the illustration ---- */
.pic {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;

  img {
    display: block;
    max-width: 100%;
    max-height: 320px;
    border-radius: var(--radius-lg);
    background: var(--sunken);
  }
  figcaption {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
  }
  input {
    flex: 1;
    min-width: 200px;
    height: 30px;
    padding: 0;
    border: 0;
    outline: none;
    background: none;
    font-size: 13px;

    &:focus {
      box-shadow: 0 1px 0 var(--accent);
    }
  }
  .credit {
    font-size: 12px;
    color: var(--muted);

    a {
      color: inherit;
    }
  }
}
.pic-add {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pic-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.add.quiet {
  color: var(--muted);
  font-weight: 500;
}
.aside.bad {
  color: var(--bad);
}
.candidates {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px;
  margin: 4px 0 0;
  padding: 0;
  list-style: none;

  button {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    padding: 0;
    border: 2px solid transparent;
    border-radius: var(--radius-lg);
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;

    &:hover,
    &:focus-visible {
      border-color: var(--accent);
      outline: none;
    }
    &:disabled {
      opacity: 0.6;
      cursor: default;
    }
  }
  img {
    display: block;
    width: 100%;
    aspect-ratio: 4 / 3;
    object-fit: cover;
    border-radius: var(--radius-md);
    background: var(--sunken);
  }
  span {
    overflow: hidden;
    padding: 0 4px 4px;
    font-size: 12px;
    color: var(--muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.options {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);

    &[data-right] {
      border-color: color-mix(in srgb, var(--good) 45%, transparent);
      background: color-mix(in srgb, var(--good-soft) 55%, var(--surface));
    }
  }

  b {
    display: flex;
    align-items: center;
    height: 30px;
    font-size: 14px;
  }
}

.mark {
  position: relative;
  display: grid;
  place-items: center;
  flex: none;
  width: 22px;
  height: 22px;
  /* (30 - 22) / 2: centered on the option field beside it. */
  margin-top: 4px;
  /* A button's own 6px side padding left a 6px cell for the 16px check. */
  padding: 0;
  border: 2px solid color-mix(in srgb, var(--ink) 30%, transparent);
  border-radius: 50%;
  background: var(--surface);
  color: white;
  cursor: pointer;

  &[aria-pressed="true"] {
    border-color: var(--good);
  }
  /* The fill is its own layer under the check, so it can grow into the
     ring (from 0.6, 150 ms) while the ring holds still; the check then
     sweeps in from the left. The choice is seen to take. */
  &::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: var(--good);
    scale: 0;
  }
  &[aria-pressed="true"]::before {
    scale: 1;
    animation: mark-fill 150ms var(--ease) both;
  }
  /* Both ends named as inset(): the element's own clip-path is none, which
     does not interpolate, so a from-only keyframe would flip rather than
     sweep. `backwards` leaves the computed value at none once it has run. */
  &[aria-pressed="true"] svg {
    position: relative;
    animation: mark-draw 150ms var(--ease) backwards;
  }
  /* The ring stays 22px; the finger gets 44. */
  &::after {
    content: "";
    position: absolute;
    inset: -11px;
  }
}
@keyframes mark-fill {
  from {
    scale: 0.6;
  }
}
@keyframes mark-draw {
  from {
    clip-path: inset(0 100% 0 0);
  }
  to {
    clip-path: inset(0 0 0 0);
  }
}

.fields {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;

  input,
  textarea {
    height: 30px;
    padding: 0;
    border: 0;
    outline: none;
    background: none;
    font-size: 15px;
  }
  .why {
    height: auto;
    min-height: 22px;
    field-sizing: content;
    resize: none;
    font-size: 13px;
    line-height: 1.45;
    color: var(--muted);
  }
  input:focus,
  textarea:focus {
    box-shadow: 0 1px 0 var(--accent);
  }
}

.add {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  height: 36px;
  margin-left: -8px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--radius-md);
  background: none;
  color: var(--accent);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    background: var(--hover);
  }
}

.block {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.topic-field {
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  gap: 8px;

  .topic {
    flex: 1;
    min-width: 0;
  }
}

.label {
  font-size: 13px;
  font-weight: 600;
  color: color-mix(in srgb, var(--ink) 70%, transparent);
}

.accepted ul {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 6px 0 0;
  padding: 0;
  list-style: none;

  li {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px 4px 10px;
    border-radius: var(--radius-full);
    background: var(--good-soft);
    font-size: 14px;
  }
  li.input {
    flex: 1;
    min-width: 180px;
    padding: 0;
    background: none;
  }
  li button {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border: 0;
    padding: 0;
    border-radius: 50%;
    background: none;
    cursor: pointer;
  }
  input {
    width: 100%;
    height: 30px;
    padding: 0 8px;
    border: 1px dashed color-mix(in srgb, var(--ink) 25%, transparent);
    border-radius: var(--radius-full);
    outline: none;
    font-size: 14px;
  }
}

.answered {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  margin: 10px 0 0;

  input {
    min-height: 36px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: inherit;
    font: inherit;
    font-size: 14px;
  }
  input {
    flex: 1 1 240px;
  }
}

.aside {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--muted);
}

.essay {
  display: flex;
  flex-direction: column;
  gap: 6px;

  textarea {
    field-sizing: content;
    min-height: 64px;
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    outline: none;
    resize: vertical;
    font-size: 14px;

    &:focus {
      border-color: var(--accent);
    }
  }
}

.notice {
  margin: 0;
  padding: 8px 12px;
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--warn) 12%, var(--surface));
  font-size: 13px;
  color: var(--ink);
}

.explain {
  min-height: 28px;
  field-sizing: content;
  resize: none;
  line-height: 1.45;
  padding: 4px 0;
  border: 0;
  outline: none;
  background: none;
  font-size: 14px;
  color: color-mix(in srgb, var(--ink) 75%, transparent);

  &:focus {
    box-shadow: 0 1px 0 var(--accent);
  }
}

.source {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 10px;
  align-items: start;
  padding-top: 10px;
  border-top: 1px solid var(--line);

  .badge {
    grid-column: 1 / -1;
    justify-self: start;
    padding: 2px 10px;
    border-radius: var(--radius-full);
    font-size: 12px;
    font-weight: 600;

    &[data-check="found"] {
      background: var(--good-soft);
      color: color-mix(in srgb, var(--good) 75%, black);
    }
    &[data-check="missing"] {
      background: var(--bad-soft);
      color: var(--bad);
    }
    &[data-check="photo"],
    &[data-check="pending"] {
      background: color-mix(in srgb, var(--warn) 15%, var(--surface));
      color: color-mix(in srgb, var(--warn) 80%, black);
    }
    &[data-check="none"] {
      background: var(--sunken);
      color: var(--muted);
    }
  }

  .quote {
    grid-column: 1 / -1;
    field-sizing: content;
    min-height: 22px;
    resize: none;
    padding: 0 0 0 10px;
    border: 0;
    border-left: 3px solid var(--accent);
    outline: none;
    background: none;
    font-style: italic;
    font-size: 14px;
    color: color-mix(in srgb, var(--ink) 70%, transparent);
  }

  .topic {
    grid-column: 1 / -1;
    justify-self: start;
    width: 220px;
    height: 26px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius-full);
    outline: none;
    background: var(--sunken);
    font-size: 12px;
  }
}

/* A phone: every control at least 44px tall. The header wraps to two rows,
   kind and level on the first, points with move and delete on the second. */
@media (max-width: 767px) {
  select,
  .points input,
  .fields input,
  .accepted ul input,
  .source .topic {
    height: 44px;
  }
  .points input {
    width: 52px;
  }
  .icon,
  .add {
    min-width: 44px;
    height: 44px;
  }
  .fields .why,
  .source .quote {
    min-height: 44px;
  }
  .options b {
    height: 44px;
  }
  .mark {
    margin-top: 11px;
  }
  /* The chip's cross stays 20px; its hit area grows to 44. */
  .accepted li button {
    position: relative;

    &::after {
      content: "";
      position: absolute;
      inset: -12px;
    }
  }
}
</style>
