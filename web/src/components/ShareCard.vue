<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue"
import { renderSVG } from "uqr"
import Icon from "./Icon.vue"
import { api } from "../composables/api"
import { useAction } from "../composables/fetch"
import { refreshQuizzes, toldText, type FullQuiz } from "../composables/quizzes"
import { toast } from "../composables/toast"

/**
 * A quiz's sharing: while it is shared, the link, a copy button and its QR
 * code; while it is a draft, the way to share it. On the overview's panel,
 * and larger on the quiz's Sharing page, with the QR code to download.
 *
 * Above the link, the Practice or Graded choice: a bundle over three of the
 * Settings page's switches. Practice has them all on (the answer and its
 * explanation after each question, hints, retakes); Graded has them all off
 * (scores held until released, no hints, one attempt per browser). Any other
 * mix is Custom, a state the Settings page sets and this control only
 * reports. The small card shows the state in a sentence with a way to the
 * Sharing page; the large one carries the control.
 */
const props = withDefaults(
  defineProps<{
    quizId: number
    status: "draft" | "published"
    shareCode: string
    questions: number
    /** The three settings the choice bundles. */
    showResults: boolean
    showHints: boolean
    allowRetake: boolean
    /** Archived: the link does not open, whatever the status says. */
    archived?: boolean
    large?: boolean
  }>(),
  { archived: false, large: false },
)
const emit = defineEmits<{ changed: [] }>()

const link = computed(() => `${location.origin}/q/${props.shareCode}`)
const qr = computed(() =>
  renderSVG(link.value, {
    border: 1,
    whiteColor: "#ffffff",
    blackColor: "#1a1a1a",
  }),
)
const qrFile = computed(
  () => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.value)}`,
)

const copied = ref(false)
async function copy() {
  await navigator.clipboard.writeText(link.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 1600)
}

const setStatus = useAction(async (status: "draft" | "published") => {
  await api(`/quizzes/${props.quizId}`, { method: "PATCH", body: { status } })
  refreshQuizzes()
  emit("changed")
  toast(
    status === "published"
      ? "Shared. Anyone with the link can answer."
      : "Sharing stopped. The link no longer opens.",
  )
})

// ---- practice or graded ---------------------------------------------------------------
type Choice = "practice" | "graded"
type Mode = Choice | "custom"

/** What each option sets, saved in one request. */
const BUNDLE: Record<
  Choice,
  Pick<FullQuiz["quiz"], "showResults" | "showHints" | "allowRetake">
> = {
  practice: { showResults: true, showHints: true, allowRetake: true },
  graded: { showResults: false, showHints: false, allowRetake: false },
}
const OPTIONS: { value: Choice; label: string; text: string }[] = [
  {
    value: "practice",
    label: "Practice",
    text: "Each answer shows the correct answer, the explanation and the source sentence. Hints are on, and the quiz can be taken again.",
  },
  {
    value: "graded",
    label: "Graded",
    text: "Scores and answers are held until you release them. No hints, and one attempt per browser.",
  },
]
const LABEL: Record<Mode, string> = {
  practice: "Practice",
  graded: "Graded",
  custom: "Custom",
}

/** The mode the three settings add up to. */
const fromProps = computed<Mode>(() => {
  const { showResults, showHints, allowRetake } = props
  if (showResults && showHints && allowRetake) return "practice"
  if (!showResults && !showHints && !allowRetake) return "graded"
  return "custom"
})
/** The option chosen, shown while its save is on the way and the parent refreshes. */
const picked = ref<Choice | null>(null)
watch(fromProps, () => (picked.value = null))
const mode = computed<Mode>(() => picked.value ?? fromProps.value)

/** The three settings as words, for the Custom state. */
const values = computed(() => [
  {
    name: "Scores and answers",
    value: props.showResults
      ? "shown after each answer"
      : "held until you release them",
  },
  { name: "Hints", value: props.showHints ? "on" : "off" },
  {
    name: "Attempts",
    value: props.allowRetake ? "more than one per browser" : "one per browser",
  },
])
const sentence = computed(() => {
  if (mode.value !== "custom")
    return OPTIONS.find((o) => o.value === mode.value)!.text
  const [results, hints] = values.value
  return `Scores and answers are ${results!.value}, hints are ${hints!.value}, and ${
    props.allowRetake
      ? "the quiz can be taken again"
      : "each browser gets one attempt"
  }.`
})

const saved = ref(false)
const announce = ref("")
let savedTimer: number | undefined
onBeforeUnmount(() => clearTimeout(savedTimer))

const setMode = useAction(async (m: Choice) => {
  if (m === mode.value) return
  picked.value = m
  try {
    const reply = await api<FullQuiz & { told?: number }>(
      `/quizzes/${props.quizId}`,
      { method: "PATCH", body: BUNDLE[m] },
    )
    saved.value = true
    announce.value = ""
    announce.value = "Saved."
    clearTimeout(savedTimer)
    savedTimer = window.setTimeout(() => (saved.value = false), 2000)
    refreshQuizzes()
    emit("changed")
    // Practice after Graded releases held results: whoever left an email is told now.
    if (reply.told) toast(toldText(reply.told))
  } catch (e) {
    picked.value = null
    throw e
  }
})

/** The segmented button is a radio group: the arrow keys move the choice. */
function onModeKey(e: KeyboardEvent) {
  const step =
    e.key === "ArrowRight" || e.key === "ArrowDown"
      ? 1
      : e.key === "ArrowLeft" || e.key === "ArrowUp"
        ? -1
        : 0
  if (!step) return
  e.preventDefault()
  const at = Math.max(
    0,
    OPTIONS.findIndex((o) => o.value === mode.value),
  )
  const next = OPTIONS[(at + step + OPTIONS.length) % OPTIONS.length]!
  setMode.run(next.value)
  const group = e.currentTarget as HTMLElement
  ;(
    group.querySelectorAll("button")[OPTIONS.indexOf(next)] as HTMLElement
  )?.focus()
}
/** Which option the Tab key lands on: the chosen one, or the first while Custom. */
const tabStop = (o: Choice) =>
  mode.value === o || (mode.value === "custom" && o === "practice") ? 0 : -1
</script>

<template>
  <div class="share-card" :data-large="large || undefined">
    <p v-if="archived" class="muted">Archived. The link does not open.</p>
    <template v-else>
      <p v-if="status === 'published'" class="muted">
        Anyone with the link can answer. They give a name and need no account.
      </p>
      <p v-else class="muted">
        The quiz is a draft. Sharing makes a link and a QR code anyone can
        answer from.
      </p>

      <!-- The Practice or Graded choice: the control on the Sharing page, the state on the overview. -->
      <div v-if="large" class="mode">
        <div class="mode-head">
          <strong id="mode-label">Practice or graded</strong>
          <span v-if="saved" class="saved" aria-hidden="true"
            ><Icon name="check" :size="16" /> Saved</span
          >
        </div>
        <span sr-only aria-live="polite">{{ announce }}</span>
        <div
          class="seg"
          role="radiogroup"
          aria-labelledby="mode-label"
          @keydown="onModeKey"
        >
          <button
            v-for="o in OPTIONS"
            :key="o.value"
            type="button"
            role="radio"
            :aria-checked="mode === o.value"
            :tabindex="tabStop(o.value)"
            @click="setMode.run(o.value)"
          >
            <Icon v-if="mode === o.value" name="check" :size="18" />
            {{ o.label }}
          </button>
          <button
            v-if="mode === 'custom'"
            type="button"
            role="radio"
            aria-checked="true"
            disabled
          >
            <Icon name="check" :size="18" /> Custom
          </button>
        </div>
        <template v-if="mode === 'custom'">
          <p class="mode-text">
            Set on the
            <RouterLink :to="`/app/quiz/${quizId}/settings`"
              >Settings page</RouterLink
            >.
          </p>
          <dl class="values">
            <template v-for="v in values" :key="v.name">
              <dt>{{ v.name }}</dt>
              <dd>{{ v.value }}</dd>
            </template>
          </dl>
        </template>
        <p v-else class="mode-text">{{ sentence }}</p>
        <p v-if="setMode.error.value" class="error" role="alert">
          {{ setMode.error.value.message }}
        </p>
      </div>
      <p v-else class="mode-line">
        <strong>{{ LABEL[mode] }}.</strong> {{ sentence }}
        <RouterLink
          :to="`/app/quiz/${quizId}/${mode === 'custom' ? 'settings' : 'sharing'}`"
          class="change"
          >Change</RouterLink
        >
      </p>

      <template v-if="status === 'published'">
        <div class="link">
          <input
            :value="link"
            readonly
            aria-label="Link to the quiz"
            @focus="($event.target as HTMLInputElement).select()"
          />
          <button btn class="small" @click="copy">
            {{ copied ? "Copied" : "Copy" }}
          </button>
        </div>
        <div
          class="qr"
          v-html="qr"
          role="img"
          aria-label="QR code for the link"
        />
        <div v-if="large" class="row">
          <a
            :href="qrFile"
            :download="`quiz-${shareCode}-qr.svg`"
            btn
            class="small"
          >
            <Icon name="download" :size="18" /> Download the QR code
          </a>
          <a :href="link" target="_blank" rel="noopener" btn class="small">
            <Icon name="open" :size="18" /> Open the quiz
          </a>
        </div>
        <button
          btn="quiet"
          class="small stop"
          :disabled="setStatus.pending.value"
          @click="setStatus.run('draft')"
        >
          Stop sharing
        </button>
      </template>
      <template v-else>
        <button
          btn="primary"
          :disabled="setStatus.pending.value || !questions"
          @click="setStatus.run('published')"
        >
          Share the quiz
        </button>
        <p v-if="!questions" class="muted">Add a question to the quiz first.</p>
      </template>
      <p v-if="setStatus.error.value" class="error" role="alert">
        {{ setStatus.error.value.message }}
      </p>
    </template>
  </div>
</template>

<style scoped>
.share-card {
  display: flex;
  flex-direction: column;
  gap: 10px;

  p {
    margin: 0;
  }
}
.muted {
  font-size: 13px;
  color: var(--muted);
}
.error {
  font-size: 13px;
  color: var(--bad);
}
.small {
  min-height: 44px;
  padding: 0 12px;
  font-size: 13px;
}
.link {
  display: flex;
  gap: 8px;

  input {
    flex: 1;
    min-width: 0;
    height: 44px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--sunken);
    font: inherit;
    font-size: 13px;
    color: var(--ink);
  }
}
.qr {
  align-self: center;
  width: 150px;
  padding: 6px;
  border-radius: var(--radius-lg);
  background: white;

  :deep(svg) {
    display: block;
    width: 100%;
    height: auto;
  }
}
.row {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}
.stop {
  align-self: center;
}

/* ---- practice or graded ---- */

/* The overview's panel: the state in one line, with the way to change it.
   The link's padding reaches 44 px without moving the line: an inline box's
   vertical padding widens what a finger can hit and leaves the layout alone. */
.mode-line {
  font-size: 13px;
  line-height: 1.5;
  color: var(--muted);

  strong {
    color: var(--ink);
    font-weight: 600;
  }
}
.change {
  margin-left: 4px;
  /* 14 px over the 13 px glyph box reads 44 px; 12 read 41. */
  padding: 14px 6px;
  margin-right: -6px;
  color: var(--accent);
  font-weight: 600;
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
}

/* The Sharing page: a Material segmented button, the sentence under it. */
.mode {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
}
.mode-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;

  strong {
    font-weight: 600;
  }
}
.saved {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--muted);
}
.seg {
  display: inline-flex;
  align-self: flex-start;
  border: 1px solid color-mix(in srgb, var(--ink) 35%, transparent);
  border-radius: var(--radius-full);
  overflow: hidden;

  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 108px;
    min-height: 44px;
    padding: 0 16px;
    border: 0;
    background: none;
    color: var(--ink);
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;

    & + button {
      border-left: 1px solid color-mix(in srgb, var(--ink) 35%, transparent);
    }
    &:hover:not(:disabled) {
      background: var(--hover);
    }
    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -3px;
    }
    &[aria-checked="true"] {
      background: color-mix(in srgb, var(--accent) 16%, var(--surface));
    }
    /* Custom: a state, not a choice; it reads as chosen and takes no click. */
    &:disabled {
      cursor: default;
    }
  }
}
.mode-text {
  font-size: 14px;
  line-height: 1.5;
  color: var(--muted);

  a {
    color: var(--accent);
    font-weight: 600;
  }
}
.values {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 14px;
  margin: 0;
  font-size: 14px;

  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
  }
}

[data-large] {
  gap: 14px;

  .muted {
    font-size: 14px;
  }
  .qr {
    width: 240px;
    padding: 10px;
  }
}

@media (max-width: 560px) {
  .seg {
    display: flex;
    align-self: stretch;

    button {
      flex: 1;
      min-width: 0;
      padding: 0 8px;
    }
  }
  .values {
    grid-template-columns: 1fr;
    gap: 2px;

    dd {
      margin-bottom: 6px;
    }
  }
}
</style>
