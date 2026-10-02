<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import ConfirmDialog from "../components/ConfirmDialog.vue"
import Icon from "../components/Icon.vue"
import IconPicker from "../components/IconPicker.vue"
import QuizHead from "../components/QuizHead.vue"
import QuizThumb from "../components/QuizThumb.vue"
import Switch from "../components/Switch.vue"
import { api, ApiError } from "../composables/api"
import { inkFor, PALETTE } from "../composables/color"
import { useAction, useFetch } from "../composables/fetch"
import {
  quizColor,
  refreshQuizzes,
  releaseText,
  toldText,
  type FullQuiz,
  type QuizSettings,
  type ResultsState,
} from "../composables/quizzes"
import { toast } from "../composables/toast"

const route = useRoute()
const router = useRouter()
const id = computed(() => Number(route.params.id))
const { data, error, loading, refresh } = useFetch<FullQuiz>(
  () => `/quizzes/${id.value}`,
)
const quiz = computed(() => data.value?.quiz)
// Who is waiting for held results, and the essays waiting for a score.
const overview = useFetch<{ results: ResultsState }>(
  () => `/quizzes/${id.value}/overview`,
)
const results = computed(() => overview.data.value?.results)

// ---- saving -----------------------------------------------------------------------
type SwitchKey =
  | "shuffleQuestions"
  | "shuffleOptions"
  | "allowRetake"
  | "showResults"
  | "showHints"
  | "aiCheck"
  | "aiEssay"

/** A value shown while its save is on the way, so a switch moves at once. */
const local = reactive<Partial<QuizSettings>>({})
/** Each control's last error, by its key. */
const failure = reactive<Record<string, string>>({})
const saved = ref<string | null>(null)
const announce = ref("")
let savedTimer: number | undefined
let queue: Promise<unknown> = Promise.resolve()

function flash(key: string) {
  saved.value = key
  announce.value = ""
  announce.value = "Saved."
  clearTimeout(savedTimer)
  savedTimer = window.setTimeout(() => (saved.value = null), 2000)
}
onBeforeUnmount(() => clearTimeout(savedTimer))

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

function save(key: string, body: Record<string, unknown>) {
  const run = queue.then(async () => {
    delete failure[key]
    try {
      const reply = await api<FullQuiz & { told?: number }>(
        `/quizzes/${id.value}`,
        { method: "PATCH", body },
      )
      data.value = reply
      flash(key)
      if ("title" in body || "icon" in body || "color" in body || "bin" in body)
        refreshQuizzes()
      return reply
    } catch (e) {
      failure[key] = message(e)
      return null
    }
  })
  queue = run
  return run
}

const confirm = ref<InstanceType<typeof ConfirmDialog>>()
const releaseNote = ref("")

const on = (k: SwitchKey) => (local[k] ?? quiz.value?.[k]) as boolean

async function toggle(k: SwitchKey, value: boolean) {
  // Showing the results is a release: whoever left an email is told now.
  const r = results.value
  if (k === "showResults" && value && r?.waiting) {
    const ok = await confirm.value?.ask({
      title: "Show the results now?",
      text: releaseText(r.waiting, r.pending),
      action: "Show and release",
    })
    if (!ok) return
  }
  local[k] = value
  const reply = await save(k, { [k]: value })
  delete local[k]
  if (k === "showResults") {
    releaseNote.value =
      reply?.told !== undefined && (r?.held || reply.told)
        ? toldText(reply.told)
        : ""
    overview.refresh()
  }
}

const release = useAction(async () => {
  const r = results.value
  const ok = await confirm.value?.ask({
    title: "Release the results?",
    text: releaseText(r?.waiting ?? 0, r?.pending ?? 0),
    action: "Release results",
  })
  if (!ok) return
  const out = await api<{ told: number; failed: number }>(
    `/quizzes/${id.value}/release`,
    { method: "POST" },
  )
  releaseNote.value = toldText(out.told, out.failed)
  await Promise.all([refresh(), overview.refresh()])
})

const when = (t: number) =>
  new Date(t * 1000).toLocaleString("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`

// ---- name and description: saved when the field loses focus ------------------------
const title = ref("")
const description = ref("")
watch(
  () => quiz.value?.id,
  () => {
    title.value = quiz.value?.title ?? ""
    description.value = quiz.value?.description ?? ""
  },
  { immediate: true },
)

async function saveTitle() {
  const t = title.value.trim()
  if (t === quiz.value?.title) {
    title.value = t
    delete failure.title
    return
  }
  if (!t) {
    failure.title = "Give the quiz a name."
    return
  }
  const reply = await save("title", { title: t })
  if (reply) title.value = reply.quiz.title
}

async function saveDescription() {
  const d = description.value.trim()
  if (d === (quiz.value?.description ?? "")) return
  const reply = await save("description", { description: d || null })
  if (reply) description.value = reply.quiz.description ?? ""
}

const blurOnEnter = (e: KeyboardEvent) => (e.target as HTMLInputElement).blur()

// ---- icon and cover ---------------------------------------------------------------
const pickerOpen = ref(false)
const pictureText = computed(() =>
  quiz.value?.image
    ? quiz.value.icon
      ? "The cover shows on the quiz's card and its shared page, in place of the icon. The icon returns when the cover is removed."
      : "The cover shows on the quiz's card and its shared page."
    : quiz.value?.icon
      ? "The icon shows on the quiz's card and its shared page. A cover takes its place once uploaded."
      : "Without an icon or a cover, the quiz's card shows its first letter on its color.",
)

const fileInput = ref<HTMLInputElement>()
const COVER_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]
const COVER_SIDE = 1600

async function prepare(file: File): Promise<Blob> {
  if (file.type === "image/gif") return file
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new ApiError(
      `${file.name} could not be read as an image. Choose a JPG, PNG, WebP or GIF image.`,
      0,
    )
  }
  const scale = Math.min(1, COVER_SIDE / Math.max(bitmap.width, bitmap.height))
  if (scale === 1 && file.size <= 600_000 && COVER_TYPES.includes(file.type)) {
    bitmap.close()
    return file
  }
  const canvas = new OffscreenCanvas(
    Math.round(bitmap.width * scale),
    Math.round(bitmap.height * scale),
  )
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.convertToBlob({ type: "image/webp", quality: 0.85 })
}

const upload = useAction(async (file: File) => {
  delete failure.picture
  const blob = await prepare(file)
  const form = new FormData()
  const name =
    blob === file ? file.name : `${file.name.replace(/\.[^.]*$/, "")}.webp`
  form.append("file", blob, name)
  data.value = await api<FullQuiz>(`/quizzes/${id.value}/image`, {
    body: form,
  })
  // The cover hides the icon, so the picker folds away with its buttons.
  pickerOpen.value = false
  flash("picture")
  refreshQuizzes()
})
function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ""
  if (file) upload.run(file)
}
const uncover = useAction(async () => {
  data.value = await api<FullQuiz>(`/quizzes/${id.value}/image`, {
    method: "DELETE",
  })
  flash("picture")
  refreshQuizzes()
})
const pictureError = computed(
  () =>
    failure.picture ??
    upload.error.value?.message ??
    uncover.error.value?.message,
)

// ---- the color --------------------------------------------------------------------
/** The color being picked (null for the default), or undefined when none is on the way. */
const picking = ref<string | null>()
/** The quiz's setting as it stands on screen. */
const chosen = computed(() =>
  picking.value === undefined ? (quiz.value?.color ?? null) : picking.value,
)
/** The color in effect: the setting, else the palette's by id. */
const color = computed(() =>
  quizColor({ id: quiz.value?.id ?? 1, color: chosen.value }),
)
/** A color outside the palette is the custom swatch's. */
const customOn = computed(
  () => !!chosen.value && !PALETTE.some((p) => p.hex === chosen.value),
)
/** The check on a chosen swatch: a glyph, so white where it reaches 3:1. */
const SWATCH_INK: Record<string, string> = Object.fromEntries(
  PALETTE.map((p) => [p.hex, inkFor(p.hex, 3)]),
)

async function setColor(hex: string | null) {
  if (hex === (quiz.value?.color ?? null)) return
  picking.value = hex
  await save("color", { color: hex })
  picking.value = undefined
}
/** The native picker moves: the page follows it; the pick is saved when it closes. */
const previewCustom = (e: Event) =>
  (picking.value = (e.target as HTMLInputElement).value)
const pickCustom = (e: Event) =>
  setColor((e.target as HTMLInputElement).value.toLowerCase())

// ---- the bin ----------------------------------------------------------------------
const bins = useFetch<{ id: number; name: string; count: number }[]>("/bins")
/** The bin as it stands on screen: the pick on its way, else the quiz's own. */
const binNow = computed(() =>
  "bin" in local ? (local.bin ?? null) : (quiz.value?.bin ?? null),
)

async function setBin(e: Event) {
  const value = (e.target as HTMLSelectElement).value
  const to = value === "" ? null : Number(value)
  if (to === (quiz.value?.bin ?? null)) return
  local.bin = to
  await save("bin", { bin: to })
  delete local.bin
}

// ---- the time limit ---------------------------------------------------------------
type Mode = "none" | "question" | "overall"
const MODES: { value: Mode; label: string }[] = [
  { value: "none", label: "None" },
  { value: "question", label: "Per question" },
  { value: "overall", label: "Overall" },
]
/** Each limit's range in seconds, the unit its field takes, and what to say outside it. */
const LIMIT = {
  question: {
    min: 10,
    max: 600,
    per: 1,
    unit: "seconds",
    fallback: 60,
    say: "Use a limit between 10 seconds and 10 minutes.",
  },
  overall: {
    min: 60,
    max: 10_800,
    per: 60,
    unit: "minutes",
    fallback: 1800,
    say: "Use a limit between 1 minute and 3 hours.",
  },
} as const

const mode = computed<Mode>(
  () => local.timeMode ?? quiz.value?.timeMode ?? "none",
)
const limitInput = ref<string | number>("")
watch(
  () => [quiz.value?.timeMode, quiz.value?.timeLimit] as const,
  ([m, secs]) => {
    limitInput.value =
      m === "question" || m === "overall"
        ? String(Math.round((secs ?? 0) / LIMIT[m].per))
        : ""
  },
  { immediate: true },
)

/** "1 minute 30 seconds", "2 hours". */
function spell(secs: number) {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  const part = (n: number, unit: string) =>
    n ? `${n} ${unit}${n === 1 ? "" : "s"}` : ""
  return [part(h, "hour"), part(m, "minute"), part(s, "second")]
    .filter(Boolean)
    .join(" ")
}
const timeText = computed(() => {
  const secs = quiz.value?.timeLimit ?? 0
  if (mode.value === "question" && quiz.value?.timeMode === "question")
    return `Each question gets ${spell(secs)}. When the time is up, the quiz moves on to the next question.`
  if (mode.value === "overall" && quiz.value?.timeMode === "overall")
    return `The whole quiz gets ${spell(secs)}. When the time is up, the attempt is finished with the answers given so far.`
  return "Respondents take as long as they need."
})

async function setMode(m: Mode) {
  if (m === mode.value) return
  const limit = m === "none" ? null : LIMIT[m].fallback
  local.timeMode = m
  delete failure.limit
  await save("time", { timeMode: m, timeLimit: limit })
  delete local.timeMode
}

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
  const at = MODES.findIndex((m) => m.value === mode.value)
  const next = MODES[(at + step + MODES.length) % MODES.length]!
  setMode(next.value)
  const group = e.currentTarget as HTMLElement
  ;(
    group.querySelectorAll("button")[MODES.indexOf(next)] as HTMLElement
  )?.focus()
}

function saveLimit() {
  const m = mode.value
  if (m === "none") return
  const range = LIMIT[m]
  // A number field hands its value back as a number, or "" when empty.
  const raw = String(limitInput.value ?? "").trim()
  const n = Number(raw)
  const secs = n * range.per
  if (!raw || !Number.isInteger(n) || secs < range.min || secs > range.max) {
    failure.limit = range.say
    return
  }
  delete failure.limit
  if (secs === quiz.value?.timeLimit) return
  save("limit", { timeMode: m, timeLimit: secs })
}

// ---- archive and delete -------------------------------------------------------------
const archived = computed(() => !!quiz.value?.archived)
const archive = useAction(async (to: boolean) => {
  data.value = await api<FullQuiz>(`/quizzes/${id.value}`, {
    method: "PATCH",
    body: { archived: to },
  })
  refreshQuizzes()
  toast(to ? "Archived. Its link no longer opens." : "Restored.")
})
const remove = useAction(async () => {
  const ok = await confirm.value?.ask({
    title: `Delete “${quiz.value?.title}”?`,
    text: "Its questions, files and every response go with it. This cannot be undone.",
    action: "Delete quiz",
    danger: true,
  })
  if (!ok) return
  await api(`/quizzes/${id.value}`, { method: "DELETE" })
  refreshQuizzes()
  await router.replace("/app")
  toast("Quiz deleted.")
})

// ---- the switches' words --------------------------------------------------------------
const SWITCHES: Record<SwitchKey, { title: string; text: string }> = {
  shuffleQuestions: {
    title: "Shuffle questions",
    text: "Gives each respondent the questions in a different order. Their answers are reviewed in the order they saw.",
  },
  shuffleOptions: {
    title: "Shuffle options",
    text: "Gives each respondent the options of every question in a different order. The review shows the letters each one saw.",
  },
  allowRetake: {
    title: "Allow more than one attempt",
    text: "Lets a person take the quiz again in the same browser. Off, that browser opens the finished attempt instead, though another browser can still start one.",
  },
  showResults: {
    title: "Show score and answers",
    text: "Shows each respondent their score and the correct answers when they finish. Off, both wait until you release them, and respondents can leave an email to be told.",
  },
  showHints: {
    title: "Show hints",
    text: "Shows a hint naming the topic and page on each question.",
  },
  aiCheck: {
    title: "Check typed answers with AI",
    text: "An identification answer that misses the key goes to Google's Gemini, which accepts a misspelling or a synonym and says why. Off, only an exact match counts, ignoring capitals, accents and punctuation.",
  },
  aiEssay: {
    title: "Score essays with AI",
    text: "Each essay goes to Google's Gemini, which scores it against the rubric; the score is marked as the AI's. Off, essays wait for your score and count as 0 until you give one.",
  },
}
</script>

<template>
  <div class="page">
    <p v-if="error" class="state" role="alert">{{ error.message }}</p>
    <div v-else-if="loading && !data" aria-label="Loading the quiz">
      <QuizHead :quiz-id="id" quiz="" page="Settings" />
      <div class="sections" aria-hidden="true">
        <section>
          <h2>Quiz</h2>
          <div stack>
            <div class="tile">
              <div skeleton="text" style="width: 12%" />
              <div skeleton style="height: 44px" />
            </div>
            <div class="tile">
              <div skeleton="text" style="width: 18%" />
              <div skeleton style="height: 88px" />
            </div>
            <div class="tile">
              <div class="picture-row">
                <div skeleton class="preview" />
                <div class="skel-lines">
                  <div skeleton="text" style="width: 30%" />
                  <div skeleton="text" style="width: 80%" />
                  <div class="actions">
                    <div skeleton style="width: 150px; height: 44px" />
                    <div skeleton style="width: 150px; height: 44px" />
                  </div>
                </div>
              </div>
            </div>
            <div v-for="n in 2" :key="n" class="tile skel-row">
              <div class="skel-lines">
                <div skeleton="text" style="width: 30%" />
                <div skeleton="text" style="width: 70%" />
              </div>
              <div
                skeleton
                style="
                  width: 52px;
                  height: 32px;
                  border-radius: var(--radius-xl);
                "
              />
            </div>
          </div>
        </section>
      </div>
    </div>
    <template v-else-if="quiz">
      <QuizHead
        :quiz-id="id"
        :quiz="quiz.title"
        page="Settings"
        :status="quiz.status"
        :archived="quiz.archived"
      />
      <p sr-only aria-live="polite">{{ announce }}</p>

      <div class="sections">
        <!-- ---- the quiz ---- -->
        <section aria-labelledby="s-quiz">
          <h2 id="s-quiz">Quiz</h2>
          <div stack>
            <div class="tile">
              <div class="tile-head">
                <label for="q-name">Name</label>
                <span v-if="saved === 'title'" class="saved" aria-hidden="true"
                  ><Icon name="check" :size="16" /> Saved</span
                >
              </div>
              <input
                id="q-name"
                v-model="title"
                field
                maxlength="160"
                autocomplete="off"
                :aria-invalid="!!failure.title || undefined"
                @blur="saveTitle"
                @keydown.enter.prevent="blurOnEnter"
              />
              <p v-if="failure.title" class="error" role="alert">
                {{ failure.title }}
              </p>
            </div>

            <div class="tile">
              <div class="tile-head">
                <label for="q-desc">Description</label>
                <span
                  v-if="saved === 'description'"
                  class="saved"
                  aria-hidden="true"
                  ><Icon name="check" :size="16" /> Saved</span
                >
                <span v-else class="count"
                  >{{ description.length }} of 1,000</span
                >
              </div>
              <textarea
                id="q-desc"
                v-model="description"
                field
                maxlength="1000"
                rows="3"
                placeholder="What the quiz covers, and anything respondents should know first."
                :aria-invalid="!!failure.description || undefined"
                @blur="saveDescription"
              />
              <p v-if="failure.description" class="error" role="alert">
                {{ failure.description }}
              </p>
            </div>

            <div class="tile picture">
              <div class="picture-row">
                <QuizThumb
                  class="preview"
                  :id="quiz.id"
                  :icon="quiz.icon"
                  :image="quiz.image"
                  :color="chosen"
                  :title="quiz.title"
                  :icon-size="40"
                />
                <div class="what">
                  <div class="tile-head">
                    <strong>Icon and cover</strong>
                    <span
                      v-if="saved === 'picture'"
                      class="saved"
                      aria-hidden="true"
                      ><Icon name="check" :size="16" /> Saved</span
                    >
                  </div>
                  <span>{{ pictureText }}</span>
                  <div class="actions">
                    <button
                      v-if="!quiz.image"
                      btn
                      type="button"
                      :aria-expanded="pickerOpen"
                      aria-controls="icon-picker"
                      @click="pickerOpen = !pickerOpen"
                    >
                      <Icon name="search" :size="18" />
                      {{ quiz.icon ? "Change icon" : "Choose an icon" }}
                    </button>
                    <button
                      btn
                      type="button"
                      :disabled="upload.pending.value"
                      @click="fileInput?.click()"
                    >
                      <Icon name="upload" :size="18" />
                      {{
                        upload.pending.value
                          ? "Uploading…"
                          : quiz.image
                            ? "Replace cover"
                            : "Upload a cover"
                      }}
                    </button>
                    <button
                      v-if="quiz.icon && !quiz.image"
                      btn="quiet"
                      type="button"
                      @click="save('picture', { icon: null })"
                    >
                      Remove icon
                    </button>
                    <button
                      v-if="quiz.image"
                      btn="quiet"
                      type="button"
                      :disabled="uncover.pending.value"
                      @click="uncover.run()"
                    >
                      Remove cover
                    </button>
                  </div>
                  <input
                    ref="fileInput"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    hidden
                    @change="onFile"
                  />
                </div>
              </div>
              <p v-if="pictureError" class="error" role="alert">
                {{ pictureError }}
              </p>
              <IconPicker
                v-if="pickerOpen && !quiz.image"
                id="icon-picker"
                :current="quiz.icon"
                @pick="(icon) => save('picture', { icon })"
              />
            </div>

            <div class="tile">
              <div class="tile-head">
                <strong id="s-color">Color</strong>
                <span v-if="saved === 'color'" class="saved" aria-hidden="true"
                  ><Icon name="check" :size="16" /> Saved</span
                >
              </div>
              <p class="hint">
                Colors the quiz's card, its page for respondents and its square
                in the sidebar.
              </p>
              <div class="swatches" role="group" aria-labelledby="s-color">
                <button
                  v-for="p in PALETTE"
                  :key="p.hex"
                  type="button"
                  class="swatch"
                  :aria-label="p.name"
                  :aria-pressed="!customOn && color === p.hex"
                  :style="{ '--c': p.hex, '--c-ink': SWATCH_INK[p.hex] }"
                  @click="setColor(p.hex)"
                >
                  <Icon
                    v-if="!customOn && color === p.hex"
                    name="check"
                    :size="20"
                  />
                </button>
                <label
                  class="swatch custom"
                  :data-on="customOn || undefined"
                  :style="{ '--c': color, '--c-ink': inkFor(color, 3) }"
                >
                  <input
                    type="color"
                    :value="color"
                    :aria-label="
                      customOn ? `Custom color, ${color}` : 'Custom color'
                    "
                    @input="previewCustom"
                    @change="pickCustom"
                  />
                  <Icon v-if="customOn" name="check" :size="20" />
                </label>
                <button
                  v-if="chosen"
                  btn="quiet"
                  type="button"
                  class="reset"
                  @click="setColor(null)"
                >
                  Use the default
                </button>
              </div>
              <p v-if="failure.color" class="error" role="alert">
                {{ failure.color }}
              </p>
            </div>

            <div class="tile">
              <div class="tile-head">
                <label for="q-bin">Bin</label>
                <span v-if="saved === 'bin'" class="saved" aria-hidden="true"
                  ><Icon name="check" :size="16" /> Saved</span
                >
              </div>
              <select
                id="q-bin"
                field
                class="bin"
                aria-describedby="bin-text"
                :aria-invalid="!!failure.bin || undefined"
                @change="setBin"
              >
                <option value="" :selected="binNow === null">None</option>
                <option
                  v-for="b in bins.data.value ?? []"
                  :key="b.id"
                  :value="b.id"
                  :selected="binNow === b.id"
                >
                  {{ b.name }}
                </option>
              </select>
              <p v-if="failure.bin" class="error" role="alert">
                {{ failure.bin }}
              </p>
              <p id="bin-text" class="hint">
                Files the quiz under a bin. Bins are made on the home page,
                above the list of quizzes.
              </p>
            </div>

            <label
              v-for="k in ['shuffleQuestions', 'shuffleOptions'] as const"
              :key="k"
              class="row"
            >
              <span class="what">
                <strong :id="`s-${k}`">{{ SWITCHES[k].title }}</strong>
                <span :id="`d-${k}`">{{ SWITCHES[k].text }}</span>
                <span v-if="failure[k]" class="error" role="alert">{{
                  failure[k]
                }}</span>
              </span>
              <span class="control">
                <span v-if="saved === k" class="saved" aria-hidden="true"
                  ><Icon name="check" :size="16" /> Saved</span
                >
                <Switch
                  :model-value="on(k)"
                  :labelledby="`s-${k}`"
                  :describedby="`d-${k}`"
                  @update:model-value="toggle(k, $event)"
                />
              </span>
            </label>
          </div>
        </section>

        <!-- ---- the time limit ---- -->
        <section aria-labelledby="s-time">
          <h2 id="s-time">Time limit</h2>
          <div stack>
            <div class="tile">
              <div class="time-row">
                <div
                  class="seg"
                  role="radiogroup"
                  aria-labelledby="s-time"
                  @keydown="onModeKey"
                >
                  <button
                    v-for="m in MODES"
                    :key="m.value"
                    type="button"
                    role="radio"
                    :aria-checked="mode === m.value"
                    :tabindex="mode === m.value ? 0 : -1"
                    @click="setMode(m.value)"
                  >
                    <Icon v-if="mode === m.value" name="check" :size="18" />
                    {{ m.label }}
                  </button>
                </div>
                <span
                  v-if="saved === 'time' || saved === 'limit'"
                  class="saved"
                  aria-hidden="true"
                  ><Icon name="check" :size="16" /> Saved</span
                >
              </div>
              <div v-if="mode !== 'none'" class="limit">
                <label for="q-limit">{{
                  mode === "question"
                    ? "Seconds for each question"
                    : "Minutes for the whole quiz"
                }}</label>
                <input
                  id="q-limit"
                  v-model="limitInput"
                  field
                  type="number"
                  inputmode="numeric"
                  :min="mode === 'question' ? 10 : 1"
                  :max="mode === 'question' ? 600 : 180"
                  step="1"
                  :aria-invalid="!!failure.limit || undefined"
                  aria-describedby="time-text"
                  @blur="saveLimit"
                  @keydown.enter.prevent="blurOnEnter"
                />
              </div>
              <p
                v-if="failure.limit || failure.time"
                class="error"
                role="alert"
              >
                {{ failure.limit ?? failure.time }}
              </p>
              <p id="time-text" class="hint">{{ timeText }}</p>
            </div>
          </div>
        </section>

        <!-- ---- responses ---- -->
        <section aria-labelledby="s-responses">
          <h2 id="s-responses">Responses</h2>
          <div stack>
            <label
              v-for="k in ['showHints', 'allowRetake', 'showResults'] as const"
              :key="k"
              class="row"
            >
              <span class="what">
                <strong :id="`s-${k}`">{{ SWITCHES[k].title }}</strong>
                <span :id="`d-${k}`">{{ SWITCHES[k].text }}</span>
                <span v-if="failure[k]" class="error" role="alert">{{
                  failure[k]
                }}</span>
              </span>
              <span class="control">
                <span v-if="saved === k" class="saved" aria-hidden="true"
                  ><Icon name="check" :size="16" /> Saved</span
                >
                <Switch
                  :model-value="on(k)"
                  :labelledby="`s-${k}`"
                  :describedby="`d-${k}`"
                  @update:model-value="toggle(k, $event)"
                />
              </span>
            </label>

            <!-- Held results, and the way to release them. -->
            <div v-if="!on('showResults') && results" class="tile release">
              <Icon name="mail" :size="22" />
              <span class="what">
                <strong>{{
                  results.held
                    ? "Results are held"
                    : `Released ${when(results.releasedAt!)}`
                }}</strong>
                <span v-if="results.waiting"
                  >{{ people(results.waiting) }} left an email to be told when
                  the results are out.</span
                >
                <span v-else-if="results.held"
                  >Nobody has left an email yet.</span
                >
                <span v-else>Everyone who left an email has been told.</span>
                <span v-if="releaseNote" class="note">{{ releaseNote }}</span>
                <span v-if="release.error.value" class="error" role="alert">{{
                  release.error.value.message
                }}</span>
              </span>
              <button
                v-if="results.held || results.waiting"
                btn="primary"
                type="button"
                :disabled="release.pending.value"
                @click="release.run()"
              >
                {{ release.pending.value ? "Releasing…" : "Release results" }}
              </button>
            </div>
            <p v-else-if="releaseNote" class="tile note-tile" role="status">
              {{ releaseNote }}
            </p>
          </div>
        </section>

        <!-- ---- the AI ---- -->
        <section aria-labelledby="s-ai">
          <h2 id="s-ai">AI checking</h2>
          <div stack>
            <label
              v-for="k in ['aiCheck', 'aiEssay'] as const"
              :key="k"
              class="row"
            >
              <span class="what">
                <strong :id="`s-${k}`">{{ SWITCHES[k].title }}</strong>
                <span :id="`d-${k}`">{{ SWITCHES[k].text }}</span>
                <span v-if="failure[k]" class="error" role="alert">{{
                  failure[k]
                }}</span>
              </span>
              <span class="control">
                <span v-if="saved === k" class="saved" aria-hidden="true"
                  ><Icon name="check" :size="16" /> Saved</span
                >
                <Switch
                  :model-value="on(k)"
                  :labelledby="`s-${k}`"
                  :describedby="`d-${k}`"
                  @update:model-value="toggle(k, $event)"
                />
              </span>
            </label>
            <RouterLink
              v-if="results?.pending && results.pendingIn"
              class="tile pending-link"
              :to="`/app/quiz/${id}/responses/${results.pendingIn}`"
            >
              <Icon name="edit" :size="22" />
              <span class="what">
                <strong
                  >{{ results.pending }}
                  {{ results.pending === 1 ? "essay waits" : "essays wait" }}
                  for your score</strong
                >
                <span>Opens the oldest response with one.</span>
              </span>
              <Icon name="forward" :size="20" />
            </RouterLink>
          </div>
        </section>

        <!-- ---- archive and delete ---- -->
        <section aria-labelledby="s-end">
          <h2 id="s-end">Archive and delete</h2>
          <div stack>
            <div class="tile action">
              <Icon :name="archived ? 'unarchive' : 'archive'" :size="22" />
              <span class="what">
                <strong>{{
                  archived ? "Restore from the archive" : "Archive"
                }}</strong>
                <span v-if="archived"
                  >The quiz goes back to your quizzes, and its link opens again
                  if it is shared.</span
                >
                <span v-else
                  >The quiz moves to Archived and its link stops opening.
                  Nothing is deleted.</span
                >
                <span v-if="archive.error.value" class="error" role="alert">{{
                  archive.error.value.message
                }}</span>
              </span>
              <button
                btn
                type="button"
                :disabled="archive.pending.value"
                @click="archive.run(!archived)"
              >
                {{ archived ? "Restore" : "Archive" }}
              </button>
            </div>
            <div class="tile action danger">
              <Icon name="delete" :size="22" />
              <span class="what">
                <strong>Delete quiz</strong>
                <span
                  >Its questions, files and every response are deleted for
                  good.</span
                >
                <span v-if="remove.error.value" class="error" role="alert">{{
                  remove.error.value.message
                }}</span>
              </span>
              <button
                btn
                type="button"
                class="delete"
                :disabled="remove.pending.value"
                @click="remove.run()"
              >
                Delete
              </button>
            </div>
          </div>
        </section>
      </div>
    </template>
    <ConfirmDialog ref="confirm" />
  </div>
</template>

<style scoped>
.page {
  width: min(100%, var(--page-w));
  padding: 28px var(--page-pad) 64px;
}
.state {
  padding: 64px 0;
  text-align: center;
  color: var(--muted);
}

.tile.skel-row {
  flex-direction: row;
  align-items: center;
  gap: 16px;
  min-height: 72px;
}
.skel-lines {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
}

.sections {
  display: flex;
  flex-direction: column;
  gap: 28px;
  max-width: 760px;

  h2 {
    margin: 0 0 10px;
    font-size: 16px;
  }
}

.tile {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 18px;
}
.tile-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;

  label,
  strong {
    font-weight: 600;
  }
}
.count {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}
textarea[field] {
  min-height: 88px;
  max-height: 240px;
  padding: 10px var(--space-md);
  line-height: 1.5;
  resize: vertical;
  field-sizing: content;
}

/* "Saved": quiet, beside the control that saved, for two seconds. */
.saved {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--muted);
}

.what {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;

  strong {
    font-weight: 600;
  }
  > span {
    font-size: 14px;
    color: var(--muted);
  }
}

/* A switch's row: the whole tile is its label, so a tap anywhere toggles it. */
.row {
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 72px;
  padding: 14px 18px;
  cursor: pointer;
  transition: background var(--fast) var(--ease);

  &:hover {
    background: color-mix(in srgb, var(--ink) 3%, var(--surface));
  }
}

/* ---- icon and cover ---- */
.picture-row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}
.preview {
  flex: none;
  width: 128px;
  height: 72px;
  border-radius: var(--radius-lg);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;

  [btn] {
    padding: 0 14px;
    font-size: 14px;
  }
  /* The button whose picker is open. */
  [aria-expanded="true"] {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, var(--surface));
  }
}

/* ---- the color: the palette's six, a custom one, and the way back ---- */
.swatches {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 0;
  /* The first disc on the heading's edge; its target reaches 4px into the padding. */
  margin-left: -4px;
}
/* A 36px disc on a 44px target; the chosen one wears a ring in its own color. */
.swatch {
  position: relative;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--c-ink);
  cursor: pointer;

  &::before {
    content: "";
    position: absolute;
    inset: 4px;
    border-radius: 50%;
    background: var(--c);
    transition: box-shadow var(--fast) var(--ease);
  }
  &:hover::before {
    box-shadow:
      0 0 0 2px var(--surface),
      0 0 0 4px color-mix(in srgb, var(--c) 45%, transparent);
  }
  &[aria-pressed="true"]::before,
  &[data-on]::before {
    box-shadow:
      0 0 0 2px var(--surface),
      0 0 0 4px var(--c);
  }
  &:focus-visible,
  &:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  > svg {
    position: relative;
    z-index: 1;
  }
}
/* The custom swatch: a rainbow ring, around the chosen color once one is picked. */
.swatch.custom {
  &::before {
    background: conic-gradient(
      from 0deg,
      #e53935,
      #fdd835,
      #43a047,
      #1e88e5,
      #8e24aa,
      #e53935
    );
  }
  &::after {
    content: "";
    position: absolute;
    inset: 9px;
    border-radius: 50%;
    background: var(--surface);
  }
  &[data-on]::after {
    background: var(--c);
  }
  input {
    position: absolute;
    inset: 0;
    z-index: 2;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
  }
}
.reset {
  margin-left: 8px;
  padding: 0 14px;
  font-size: 14px;
}

/* ---- the bin: a select the width of a bin's name, not of the tile ---- */
select.bin {
  max-width: 320px;
  /* Room for the arrow, which the field's own padding would write over. */
  padding-right: 34px;
  cursor: pointer;
}

/* ---- the time limit: a Material segmented button ---- */
.time-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.seg {
  display: inline-flex;
  border: 1px solid color-mix(in srgb, var(--ink) 35%, transparent);
  border-radius: var(--radius-full);
  overflow: hidden;

  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 96px;
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
    &:hover {
      background: var(--hover);
    }
    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -3px;
    }
    &[aria-checked="true"] {
      background: color-mix(in srgb, var(--accent) 16%, var(--surface));
    }
  }
}
.limit {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;

  label {
    font-size: 14px;
    font-weight: 600;
  }
  input {
    width: 160px;
  }
}
.hint {
  margin: 0;
  font-size: 14px;
  color: var(--muted);
}

/* ---- results held, an essay waiting, archive, delete: icon, words, action ---- */
.release,
.action,
.pending-link {
  flex-direction: row;
  align-items: center;
  gap: 14px;

  > svg {
    flex: none;
    color: var(--muted);
  }
}
.release {
  background: color-mix(in srgb, var(--accent) 7%, var(--surface));
}
.note,
.note-tile {
  color: var(--good) !important;
  font-weight: 600;
}
.note-tile {
  margin: 0;
  font-size: 14px;
}
.pending-link {
  min-height: 64px;
  color: var(--ink);
  text-decoration: none;

  &:hover {
    background: color-mix(in srgb, var(--ink) 3%, var(--surface));
  }
}
.danger {
  strong,
  > svg {
    color: var(--bad) !important;
  }
}
.delete {
  border-color: color-mix(in srgb, var(--bad) 40%, transparent);
  color: var(--bad);
}
.error {
  margin: 0;
  font-size: 14px;
  color: var(--bad) !important;
}

.control {
  display: flex;
  flex: none;
  align-items: center;
  gap: 12px;
}

@media (max-width: 560px) {
  .row {
    align-items: flex-start;
  }
  /* "Saved" goes under the switch, so the words beside it do not reflow. */
  .control {
    position: relative;
    margin-top: 4px;

    .saved {
      position: absolute;
      top: calc(100% + 10px);
      right: 0;
      white-space: nowrap;
    }
  }
  .picture-row {
    flex-direction: column;
  }
  .preview {
    width: 100%;
    height: 120px;
  }
  /* Wrapped under the swatches, the button's label starts where the discs do. */
  .reset {
    margin-left: -10px;
  }
  .seg {
    display: flex;
    width: 100%;

    button {
      flex: 1;
      min-width: 0;
      padding: 0 8px;
    }
  }
  .release,
  .action {
    flex-wrap: wrap;

    .what {
      flex-basis: calc(100% - 40px);
    }
    [btn] {
      margin-left: 36px;
    }
  }
}
</style>
