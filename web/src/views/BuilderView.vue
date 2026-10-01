<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { onBeforeRouteLeave, useRoute } from "vue-router"
import Icon from "../components/Icon.vue"
import LogoMark from "../components/LogoMark.vue"
import PromptBox from "../components/PromptBox.vue"
import DraftPreview from "../components/DraftPreview.vue"
import QuestionCard from "../components/QuestionCard.vue"
import { api, ApiError } from "../composables/api"
import {
  blankQuestion,
  KIND_LABEL,
  KINDS,
  refreshQuizzes,
  useQuizzes,
  type FullQuiz,
  type Kind,
  type Question,
} from "../composables/quizzes"
import { toast } from "../composables/toast"

const route = useRoute()
const id = computed(() => Number(route.params.id))

/** The quiz as the server last sent it. */
const saved = ref<FullQuiz | null>(null)
/** The copy being edited. Each question carries a key for the list. */
const title = ref("")
const questions = ref<(Question & { _key: number })[]>([])
let nextKey = 1
// A deep copy by JSON: the data is plain, and structuredClone refuses Vue's
// reactive proxies (DataCloneError).
const keyed = (q: Question) => ({
  ...(JSON.parse(JSON.stringify(q)) as Question),
  _key: nextKey++,
})

const loadError = ref("")
const error = ref("")
const working = ref<"" | "draft" | "chat" | "save">("")
/** The AI is on it (a save is not): the chat box shows its working look. */
const aiWorking = computed(
  () => working.value === "draft" || working.value === "chat",
)

/**
 * The draft's cards, by key range: they rise in one after another, the way
 * they were written. A card added by hand later has a key past the range
 * and simply appears.
 */
const rising = ref<[number, number]>([0, 0])
const rises = (key: number) => key >= rising.value[0] && key < rising.value[1]
/**
 * The cards a chat reply changed, by key. The reply replaces every key, so
 * a changed card is one whose content (as saved) was not on screen before
 * the reply; it flashes its border once.
 */
const changed = ref(new Set<number>())
/** The cards a chat reply added, by key: each slides into its place. */
const added = ref(new Set<number>())
/** How many questions the last chat reply removed, for its summary line. */
const removed = ref(0)
/** The reply whose summary line (what changed) is shown under its text. */
const lastReply = ref(0)

/**
 * The reply that just arrived streams in word by word, about 18 ms a word
 * and never longer than 1.6 s in all. The text comes whole from the server;
 * this is a reading pace, not the network's. Under reduced motion the whole
 * text is on screen at once.
 */
const stream = ref<{ id: number; shown: number; tokens: string[] } | null>(null)
let streamFrame = 0
function streamReply() {
  const m = [...(saved.value?.messages ?? [])]
    .reverse()
    .find((x) => x.role === "ai")
  if (!m) return
  cancelAnimationFrame(streamFrame)
  const tokens = m.text.match(/\S+\s*|\s+/g) ?? []
  if (
    !tokens.length ||
    matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    stream.value = null
    return
  }
  stream.value = { id: m.id, shown: 1, tokens }
  // The pace is counted from the first frame drawn, not from here: the reply
  // redraws every card first (125 to 170 ms on a two-core laptop), and the
  // words due in that time landed in one lump, nine at once. The 1.6 s is
  // counted from here, so the redraw comes out of a long reply's time. The
  // clock is performance.now(): the frame's own timestamp is the time the
  // frame was asked for, before the redraw.
  const arrived = performance.now()
  let t0 = 0
  let per = 18
  const step = () => {
    const st = stream.value
    if (!st || st.id !== m.id) return
    const t = performance.now()
    if (!t0) {
      t0 = t
      per = Math.max(0.01, Math.min(18, (1600 - (t - arrived)) / tokens.length))
    }
    st.shown = Math.min(tokens.length, Math.floor((t - t0) / per) + 1)
    if (st.shown < tokens.length) streamFrame = requestAnimationFrame(step)
    else stream.value = null
  }
  streamFrame = requestAnimationFrame(step)
}
const streamText = computed(() =>
  stream.value ? stream.value.tokens.slice(0, stream.value.shown).join("") : "",
)
onBeforeUnmount(() => cancelAnimationFrame(streamFrame))

/** "1, 3 and 5" */
const listOf = (ns: number[]) =>
  ns.length < 2
    ? String(ns[0] ?? "")
    : `${ns.slice(0, -1).join(", ")} and ${ns[ns.length - 1]}`
/** What the last reply did to the list, in a sentence under its text. */
const changedSummary = computed(() => {
  const at = (keys: Set<number>) =>
    questions.value.flatMap((q, i) => (keys.has(q._key) ? [i + 1] : []))
  const say = (verb: string, ns: number[]) =>
    ns.length
      ? `${verb} ${ns.length === 1 ? "question" : "questions"} ${listOf(ns)}.`
      : ""
  const r = removed.value
  return [
    say("Changed", at(changed.value)),
    say("Added", at(added.value)),
    r ? `Removed ${r} ${r === 1 ? "question" : "questions"}.` : "",
  ]
    .filter(Boolean)
    .join(" ")
})

/** The phase the draft is in, for the questions pane: a timer tuned to the measured draft. */
const draftPhase = ref("")
let phaseTimer: ReturnType<typeof setTimeout> | undefined

function adopt(d: FullQuiz) {
  saved.value = d
  title.value = d.quiz.title
  questions.value = d.questions.map(keyed)
}

const strip = (list: Question[]) =>
  list.map(({ check: _c, id: _i, ...q }) => {
    const { _key: _k, ...rest } = q as Question & { _key?: number }
    return rest
  })
/** The saved questions as text, to compare the edited copy against. */
const savedText = computed(() =>
  JSON.stringify(strip(saved.value?.questions ?? [])),
)
const dirty = computed(
  () =>
    !!saved.value &&
    (title.value !== saved.value.quiz.title ||
      JSON.stringify(strip(questions.value)) !== savedText.value),
)

// ---- loading, and the first draft -------------------------------------------
onMounted(async () => {
  try {
    adopt(await api<FullQuiz>(`/quizzes/${id.value}`))
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
    return
  }
  // A quiz fresh from the prompt box has the request and no questions yet.
  if (
    !saved.value!.questions.length &&
    !saved.value!.messages.some((m) => m.role === "ai")
  ) {
    aiOpen.value = true
    await draft()
  }
})

async function draft() {
  working.value = "draft"
  const from = nextKey
  error.value = ""
  draftPhase.value = "Reading the module"
  clearTimeout(phaseTimer)
  phaseTimer = setTimeout(
    () => (draftPhase.value = "Writing the questions"),
    3000,
  )
  try {
    const d = await api<FullQuiz>(`/quizzes/${id.value}/draft`, {
      method: "POST",
    })
    // The reply is in; the cards come on the next frame.
    clearTimeout(phaseTimer)
    draftPhase.value = "Checking each quote against the file"
    await new Promise((r) => requestAnimationFrame(() => r(undefined)))
    adopt(d)
    rising.value = [from, nextKey]
    streamReply()
    refreshQuizzes()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    clearTimeout(phaseTimer)
    working.value = ""
  }
}
onBeforeUnmount(() => clearTimeout(phaseTimer))

// ---- saving -------------------------------------------------------------------
const savedFlash = ref(false)
async function save() {
  if (working.value) return
  working.value = "save"
  error.value = ""
  try {
    adopt(
      await api<FullQuiz>(`/quizzes/${id.value}`, {
        method: "PUT",
        body: { title: title.value, questions: strip(questions.value) },
      }),
    )
    refreshQuizzes()
    savedFlash.value = true
    setTimeout(() => (savedFlash.value = false), 1800)
    toast("Saved.")
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    working.value = ""
  }
}

// Leaving with unsaved edits asks first; so does closing the tab.
onBeforeRouteLeave(
  () =>
    !dirty.value ||
    window.confirm("You have unsaved changes. Leave without saving them?"),
)
const beforeUnload = (e: BeforeUnloadEvent) => {
  if (dirty.value) e.preventDefault()
}
onMounted(() => window.addEventListener("beforeunload", beforeUnload))
onBeforeUnmount(() => window.removeEventListener("beforeunload", beforeUnload))

// ---- the chat -----------------------------------------------------------------
const box = ref<InstanceType<typeof PromptBox>>()
const thread = ref<HTMLElement>()
const pendingText = ref("")

async function chat(text: string, sources: number[]) {
  if (working.value) return
  error.value = ""
  // Edits made by hand go to the server first, so the AI edits what is on screen.
  if (dirty.value) {
    await save()
    if (error.value) return
  }
  working.value = "chat"
  pendingText.value = text || "Use this material too."
  box.value?.clear()
  const before = new Set(strip(questions.value).map((q) => JSON.stringify(q)))
  const count = questions.value.length
  try {
    adopt(
      await api<FullQuiz>(`/quizzes/${id.value}/chat`, {
        body: { message: text, sources },
      }),
    )
    // A card the list did not hold before: changed in place, or, past the
    // old count, added (the AI appends).
    const flagged = questions.value.filter(
      (q) => !before.has(JSON.stringify(strip([q])[0])),
    )
    added.value = new Set(
      flagged
        .filter((q) => questions.value.indexOf(q) >= count)
        .map((q) => q._key),
    )
    changed.value = new Set(
      flagged.filter((q) => !added.value.has(q._key)).map((q) => q._key),
    )
    removed.value = Math.max(0, count - questions.value.length)
    lastReply.value =
      [...(saved.value?.messages ?? [])].reverse().find((m) => m.role === "ai")
        ?.id ?? 0
    streamReply()
    refreshQuizzes()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    working.value = ""
    pendingText.value = ""
  }
}

/** The thread has something to show: a message, a reply on its way, an error. */
const hasThread = computed(
  () =>
    !!saved.value?.messages.length ||
    !!pendingText.value ||
    !!working.value ||
    !!error.value,
)
/** The chat holds nothing past the first draft's exchange. */
const fresh = computed(() => {
  const ms = saved.value?.messages ?? []
  const firstAi = ms.findIndex((m) => m.role === "ai")
  return !ms.slice(firstAi + 1).some((m) => m.role === "user")
})
/** Three asks the chat can take, worded for this quiz. */
const starters = computed(() => [
  `Make question ${Math.min(4, Math.max(1, questions.value.length))} harder`,
  saved.value?.sources.length
    ? "Add two questions from page 2"
    : "Add two more questions",
  saved.value?.quiz.language === "fil"
    ? "Put the hints in English"
    : "Put the hints in Filipino",
])
function suggest(text: string) {
  box.value?.fill(text)
}

// The streaming bubble grows; the thread keeps its end in view.
watch(streamText, () => {
  const el = thread.value
  if (el) el.scrollTop = el.scrollHeight
})

// Keep the newest message in view.
watch(
  () => [saved.value?.messages.length, working.value],
  async () => {
    await nextTick()
    thread.value?.scrollTo({
      top: thread.value.scrollHeight,
      behavior: "smooth",
    })
  },
)

// What the AI is doing, in turn, while it works (the steps it really takes).
const STEPS = {
  draft: [
    "Reading the material…",
    "Writing the questions…",
    "Checking every quote against the file…",
  ],
  chat: [
    "Reading your message…",
    "Changing the quiz…",
    "Checking the quotes again…",
  ],
}
const step = ref(0)
let stepTimer: ReturnType<typeof setInterval> | undefined
watch(working, (w) => {
  clearInterval(stepTimer)
  step.value = 0
  if (w === "draft" || w === "chat")
    stepTimer = setInterval(
      () => (step.value = Math.min(step.value + 1, 2)),
      6000,
    )
})
onBeforeUnmount(() => clearInterval(stepTimer))

// ---- the questions --------------------------------------------------------------
function add(kind: Kind) {
  const q = blankQuestion(kind)
  if (kind === "truefalse" && saved.value?.quiz.language === "fil")
    q.choices = [
      { text: "Tama", why: "" },
      { text: "Mali", why: "" },
    ]
  questions.value.push(keyed(q))
  nextTick(() =>
    document
      .querySelector<HTMLElement>(".qlist > :last-child textarea")
      ?.focus(),
  )
}
function move(i: number, by: number) {
  const list = questions.value
  const [q] = list.splice(i, 1)
  list.splice(i + by, 0, q!)
}

const counts = computed(() => {
  const c = { found: 0, missing: 0, photo: 0, none: 0 }
  for (const q of saved.value?.questions ?? []) c[q.check ?? "none"]++
  return c
})
const points = computed(() =>
  questions.value.reduce((s, q) => s + (q.points || 0), 0),
)

// ---- layout: rail tabs on a wide screen, three tabs on a phone ------------------
const panel = ref<"chat" | "files">("chat")
const phoneTab = ref<"chat" | "questions" | "files">("questions")

// The AI panel (chat and files) is the onboarding. It opens for a quiz started
// from the prompt box (?ai=1), for one with nothing in it yet, and on "Edit
// with AI"; a quiz opened from the list is the plain editor.
const aiOpen = ref(route.query.ai === "1")
function openAi() {
  aiOpen.value = true
  panel.value = "chat"
  phoneTab.value = "chat"
}
function closeAi() {
  aiOpen.value = false
  phoneTab.value = "questions"
}
watch(working, (w) => {
  if (w === "draft") phoneTab.value = "chat"
})

const fmtSize = (b: number) =>
  b < 1048576
    ? `${Math.max(1, Math.round(b / 1024))} KB`
    : `${(b / 1048576).toFixed(1)} MB`

/** "the file", or "the files" once the material is more than one. */
const inFiles = computed(() =>
  (saved.value?.sources.length ?? 0) > 1 ? "the files" : "the file",
)

/** A file's line in the Files tab: its pages, how it was read, its size. */
function fileLine(s: FullQuiz["sources"][number]) {
  const what =
    s.mime !== "application/pdf"
      ? "Photo"
      : s.pages
        ? `${s.pages} ${s.pages === 1 ? "page" : "pages"}`
        : "PDF"
  const read =
    s.status === "reading"
      ? "being read"
      : s.status === "failed"
        ? "could not be read"
        : s.method === "ai"
          ? "read by AI"
          : s.method === "mixed"
            ? "partly read by AI"
            : ""
  return [what, read, fmtSize(s.size)].filter(Boolean).join(" · ")
}
const secs = (ms?: number) => (ms ? `${Math.round(ms / 1000)} s` : "")
const isApiError = (e: unknown): e is ApiError => e instanceof ApiError
void isApiError

// ---- a quiz people have already answered ---------------------------------------
// The count of finished responses, from the shared quiz list. An edit keeps
// each question's row, so answers stay with their questions; the note says
// what an edit does and does not change.
const { quizzes: allQuizzes } = useQuizzes()
const answeredBy = computed(
  () =>
    allQuizzes.value.find((q) => q.id === saved.value?.quiz.id)?.responses ?? 0,
)
</script>

<template>
  <div class="builder">
    <header class="topbar">
      <RouterLink
        :to="`/app/quiz/${id}`"
        class="icon-button"
        aria-label="Back to the overview"
        title="Back to the overview"
      >
        <Icon name="back" :size="22" />
      </RouterLink>
      <div class="name">
        <input
          v-model="title"
          class="title"
          aria-label="Quiz title"
          placeholder="Quiz title"
          :disabled="!saved"
        />
        <span v-if="saved" class="status" :data-status="saved.quiz.status">
          {{ saved.quiz.status === "published" ? "Shared" : "Draft" }}
        </span>
      </div>
      <span class="spacer" />
      <span v-if="dirty" class="unsaved">Unsaved changes</span>
      <!-- The print reads the saved quiz, so it waits for a save. -->
      <button
        v-if="dirty || !saved?.questions.length"
        type="button"
        class="icon-button print"
        disabled
        :aria-label="
          dirty ? 'Save first to print the latest' : 'Add questions to print'
        "
        :title="
          dirty ? 'Save first to print the latest' : 'Add questions to print'
        "
      >
        <Icon name="print" :size="22" />
      </button>
      <RouterLink
        v-else
        :to="`/app/quiz/${id}/print`"
        class="icon-button print"
        aria-label="Print as a test"
        title="Print as a test"
      >
        <Icon name="print" :size="22" />
      </RouterLink>
      <button
        btn="primary"
        class="save"
        :disabled="!dirty || !!working"
        @click="save"
      >
        {{ working === "save" ? "Saving…" : savedFlash ? "Saved" : "Save" }}
      </button>
    </header>

    <p v-if="loadError" class="load-error" role="alert">
      {{ loadError }} <RouterLink to="/app">Back to your quizzes</RouterLink>
    </p>

    <template v-else>
      <nav v-if="aiOpen" class="phone-tabs" aria-label="Builder">
        <button
          v-for="t in ['chat', 'questions', 'files'] as const"
          :key="t"
          :aria-pressed="phoneTab === t"
          @click="phoneTab = t"
        >
          {{
            t === "chat"
              ? "Chat"
              : t === "questions"
                ? `Questions (${questions.length})`
                : "Files"
          }}
        </button>
      </nav>

      <div class="workspace" :data-ai="aiOpen || undefined">
        <template v-if="aiOpen">
          <nav class="rail" aria-label="Panels">
            <button
              :aria-pressed="panel === 'chat'"
              aria-label="Chat"
              title="Chat"
              @click="panel = 'chat'"
            >
              <Icon name="chat" :size="22" />
            </button>
            <button
              :aria-pressed="panel === 'files'"
              aria-label="Files"
              title="Files"
              @click="panel = 'files'"
            >
              <Icon name="folder" :size="22" />
            </button>
            <button
              class="close-ai"
              aria-label="Close the AI panel"
              title="Close the AI panel"
              @click="closeAi"
            >
              <Icon name="close" :size="20" />
            </button>
          </nav>

          <!-- The chat -->
          <aside
            class="panel"
            v-show="panel === 'chat'"
            :data-phone-show="phoneTab === 'chat' || undefined"
          >
            <div
              v-show="hasThread"
              class="thread"
              ref="thread"
              aria-live="polite"
            >
              <template v-for="m in saved?.messages ?? []" :key="m.id">
                <div class="msg" :data-role="m.role">
                  <span v-if="m.role === 'ai'" class="avatar"
                    ><LogoMark :size="18"
                  /></span>
                  <div class="bubble">
                    <!-- The words land one by one, a 2px bar after the last
                         so far; a screen reader gets the whole text. -->
                    <template v-if="stream?.id === m.id">
                      <p aria-hidden="true">
                        {{ streamText }}<i class="caret" />
                      </p>
                      <span class="sr-only">{{ m.text }}</span>
                    </template>
                    <p v-else>{{ m.text }}</p>
                    <ul v-if="m.meta?.files?.length" class="attached">
                      <li v-for="f in m.meta.files" :key="f">
                        <Icon name="file" :size="14" /> {{ f }}
                      </li>
                    </ul>
                    <small
                      v-if="
                        m.role === 'ai' &&
                        stream?.id !== m.id &&
                        (m.meta?.questions || m.meta?.ms)
                      "
                      class="after"
                    >
                      <template v-if="m.meta?.questions"
                        >{{ m.meta.questions }} questions ·
                        {{ m.meta.found }} found in {{ inFiles }} · </template
                      >{{ secs(m.meta?.ms) }}
                    </small>
                    <small
                      v-if="
                        m.role === 'ai' &&
                        m.id === lastReply &&
                        stream?.id !== m.id &&
                        changedSummary
                      "
                      class="after ops"
                      >{{ changedSummary }}</small
                    >
                  </div>
                </div>
              </template>
              <div v-if="pendingText" class="msg" data-role="user">
                <div class="bubble">
                  <p>{{ pendingText }}</p>
                </div>
              </div>
              <div
                v-if="working === 'draft' || working === 'chat'"
                class="msg"
                data-role="ai"
              >
                <span class="avatar"><LogoMark :size="18" /></span>
                <div class="bubble working" role="status">
                  <span class="dots" aria-hidden="true"><i /><i /><i /></span>
                  {{ STEPS[working][step] }}
                </div>
              </div>
              <div v-if="error" class="msg" data-role="ai">
                <span class="avatar"><LogoMark :size="18" /></span>
                <div class="bubble failed" role="alert">
                  <p>{{ error }}</p>
                  <button
                    v-if="!saved?.questions.length"
                    class="link"
                    @click="draft"
                  >
                    Try the draft again
                  </button>
                </div>
              </div>
            </div>
            <!-- Until the chat has an ask of its own: what it is for, and three
                 asks it can take, each filling the box. -->
            <div
              v-if="saved && fresh && !working && !pendingText"
              class="starter"
              :data-alone="!hasThread || undefined"
            >
              <p>Changes are made from here. Attach more pages with&nbsp;+.</p>
              <div class="chips">
                <button
                  v-for="s in starters"
                  :key="s"
                  type="button"
                  @click="suggest(s)"
                >
                  {{ s }}
                </button>
              </div>
            </div>
            <PromptBox
              ref="box"
              compact
              :busy="aiWorking"
              :off="!saved || working === 'save'"
              placeholder="Ask for a change."
              :hint="aiWorking ? 'The AI is working…' : ''"
              @send="chat"
            />
          </aside>

          <!-- The files -->
          <aside
            v-show="panel === 'files'"
            class="panel files"
            :data-phone-show="phoneTab === 'files' || undefined"
          >
            <h2>Material</h2>
            <ul v-if="saved?.sources.length">
              <li v-for="s in saved.sources" :key="s.id">
                <Icon
                  :name="s.mime === 'application/pdf' ? 'file' : 'image'"
                  :size="18"
                />
                <span>
                  <strong>{{ s.name }}</strong>
                  <small>{{ fileLine(s) }}</small>
                </span>
              </li>
            </ul>
            <p v-else class="empty">
              No files yet. The questions come from your request alone, so check
              them yourself.
            </p>
            <p class="aside">
              Attach more material from the chat: the AI uses it for the next
              change.
            </p>
          </aside>
        </template>

        <!-- The questions -->
        <main :data-phone-show="phoneTab === 'questions' || undefined">
          <div v-if="!saved" class="loading" aria-label="Loading the quiz">
            <div v-for="n in 3" :key="n" class="qcard-skel" aria-hidden="true">
              <div skeleton style="width: 40%; height: 30px" />
              <div skeleton="text" style="width: 85%" />
              <div skeleton style="height: 56px" />
              <div skeleton style="height: 56px" />
            </div>
          </div>
          <DraftPreview
            v-else-if="working === 'draft' && !questions.length"
            :status="draftPhase"
          />
          <template v-else>
            <div class="summary-bar">
              <strong
                >{{ questions.length }}
                {{ questions.length === 1 ? "question" : "questions" }} ·
                {{ points }} {{ points === 1 ? "point" : "points" }}</strong
              >
              <span v-if="counts.found" class="pill found"
                >{{ counts.found }} found in {{ inFiles }}</span
              >
              <span v-if="counts.missing" class="pill missing"
                >{{ counts.missing }} not found in {{ inFiles }}</span
              >
              <span v-if="counts.photo" class="pill photo"
                >{{ counts.photo }} from photos: check by eye</span
              >
              <button v-if="!aiOpen" btn class="ai-button" @click="openAi">
                <Icon name="sparkle" :size="18" /> Edit with AI
              </button>
            </div>
            <p v-if="answeredBy" class="answered-note" role="note">
              {{ answeredBy }}
              {{ answeredBy === 1 ? "person has" : "people have" }} answered
              this quiz. An edit keeps their answers and their scores as they
              were graded. Deleting a question deletes its answers.
            </p>

            <div class="qlist">
              <QuestionCard
                v-for="(q, i) in questions"
                :key="q._key"
                v-model="questions[i]!"
                :index="i"
                :total="questions.length"
                :language="saved.quiz.language"
                :quiz-id="saved.quiz.id"
                :style="{ '--i': q._key - rising[0] }"
                :data-rise="rises(q._key) || undefined"
                :data-changed="changed.has(q._key) || undefined"
                :data-new="added.has(q._key) || undefined"
                @remove="questions.splice(i, 1)"
                @up="move(i, -1)"
                @down="move(i, 1)"
              />
            </div>

            <div class="add-row">
              <span>Add a question:</span>
              <button v-for="k in KINDS" :key="k" btn @click="add(k)">
                <Icon name="plus" :size="16" /> {{ KIND_LABEL[k] }}
              </button>
            </div>
          </template>
        </main>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* Shown once people have answered: what an edit keeps and what it removes. */
.answered-note {
  margin: 0 0 12px;
  padding: 10px 14px;
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--warn) 12%, var(--surface));
  font-size: 14px;
}
.builder {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  background: var(--bg);
}

.topbar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
  height: 60px;
  padding-inline: 10px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
}

.icon-button {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-lg);
  color: var(--ink);

  &:hover {
    background: var(--hover);
  }
}

/* The name and its status, beside each other; a column on a phone. */
.name {
  display: flex;
  flex: 0 1 auto;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

/* As wide as the title itself, so the status chip sits beside it. */
.title {
  min-width: 8ch;
  max-width: min(520px, 100%);
  flex: 0 1 auto;
  field-sizing: content;
  height: 40px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  background: none;
  font: 650 20px var(--font-heading);
  color: var(--ink);
  text-overflow: ellipsis;

  &:hover {
    border-color: var(--line);
  }
  &:focus {
    outline: none;
    border-color: var(--accent);
  }
}

.status {
  padding: 2px 10px;
  border-radius: var(--radius-full);
  background: var(--sunken);
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);

  &[data-status="published"] {
    background: color-mix(in srgb, var(--accent) 12%, var(--surface));
    color: var(--accent);
  }
}

.spacer {
  flex: 1;
}

.unsaved {
  font-size: 13px;
  color: var(--muted);
}

.save {
  min-width: 92px;

  /* Nothing to save: Material's disabled fill (12% of the ink, 38% text)
     rather than the accent at 60%, which read as a live button. */
  &:disabled {
    opacity: 1;
    border-color: transparent;
    background: color-mix(in srgb, var(--ink) 12%, transparent);
    color: color-mix(in srgb, var(--ink) 38%, transparent);
  }
}

.load-error {
  margin: 64px auto;
  text-align: center;
}

.phone-tabs {
  display: none;
}

.workspace {
  display: grid;
  flex: 1;
  grid-template-columns: 1fr;
  min-height: 0;

  &[data-ai] {
    grid-template-columns: 56px 380px 1fr;
  }
}

.ai-button {
  margin-left: auto;
  min-height: 36px;
  padding: 0 14px;
  font-size: 14px;
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 35%, transparent);
}

.close-ai {
  margin-top: auto;
  margin-bottom: 10px;
}

.rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding-top: 10px;
  border-right: 1px solid var(--line);
  background: var(--surface);

  button {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border: 0;
    border-radius: var(--radius-lg);
    background: none;
    color: var(--muted);
    cursor: pointer;

    &:hover {
      background: var(--hover);
    }
    &[aria-pressed="true"] {
      background: color-mix(in srgb, var(--accent) 12%, transparent);
      color: var(--accent);
    }
  }
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  padding: 12px;
  border-right: 1px solid var(--line);
  background: var(--surface);
}

.thread {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 2px;
}

.msg {
  display: flex;
  gap: 8px;
  align-items: flex-start;

  &[data-role="user"] {
    justify-content: flex-end;

    .bubble {
      max-width: 85%;
      background: color-mix(in srgb, var(--accent) 10%, var(--surface));
      border-color: transparent;
    }
  }
}

.avatar {
  display: grid;
  place-items: center;
  flex: none;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--accent);
}

.bubble {
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  font-size: 14px;
  line-height: 1.5;

  p {
    margin: 0;
    white-space: pre-wrap;
  }
  small {
    display: block;
    margin-top: 6px;
    font-size: 12px;
    color: var(--muted);
  }
  &.failed {
    border-color: color-mix(in srgb, var(--bad) 40%, transparent);
    background: var(--bad-soft);
  }
  &.working {
    display: flex;
    align-items: center;
    gap: 10px;
    color: color-mix(in srgb, var(--ink) 70%, transparent);
  }
  /* The lines under a reply (its numbers, what it changed) come after the
     last word has landed. */
  .after {
    animation: fade-in var(--fast) var(--ease) both;
  }
  .ops {
    margin-top: 2px;
    color: var(--ink);
  }
}
/* The bar after the newest word: 2px, in the line's height and not its
   width, so the text wraps as it will once it is whole. */
.caret {
  display: inline-block;
  width: 0;
  height: 1em;
  margin-right: -2px;
  border-left: 2px solid var(--accent);
  vertical-align: -0.15em;
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

.attached {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;

  li {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: var(--radius-tile);
    background: var(--surface);
    font-size: 12px;
  }
}

.dots {
  display: inline-flex;
  gap: 4px;

  i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
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

.starter {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 2px;

  p {
    margin: 0;
    font-size: 14px;
    line-height: 1.5;
    color: var(--muted);
    text-wrap: pretty;
  }
  /* With no thread above it, the pane's empty state: in the middle. */
  &[data-alone] {
    flex: 1;
    justify-content: center;
    align-items: center;
    text-align: center;

    .chips {
      justify-content: center;
    }
  }
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;

  button {
    min-height: 36px;
    padding: 0 14px;
    border: 1px solid var(--line);
    border-radius: var(--radius-full);
    background: var(--surface);
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    color: var(--ink);
    text-align: left;
    cursor: pointer;

    &:hover {
      background: var(--hover);
    }
    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
  }
}

.link {
  margin-top: 6px;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-weight: 600;
  color: var(--accent);
  cursor: pointer;
}

.files {
  h2 {
    margin: 4px 4px 0;
    font-size: 16px;
  }
  ul {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 10px;
    border-radius: var(--radius-lg);
    background: var(--sunken);

    span {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    strong {
      font-size: 14px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    small {
      font-size: 12px;
      color: var(--muted);
    }
  }
  .empty,
  .aside {
    margin: 0 4px;
    font-size: 13px;
    color: var(--muted);
  }
}

main {
  min-height: 0;
  overflow-y: auto;
  padding: 20px clamp(12px, 3vw, 40px) 64px;
}

/* The loading state, in the shape of the first three question cards. */
.loading {
  display: flex;
  flex-direction: column;
}
.qcard-skel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 18px;
  margin-bottom: 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  background: var(--surface);
}

.summary-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  max-width: 820px;
  margin: 0 auto 14px;

  strong {
    margin-right: 6px;
    font: 650 17px var(--font-heading);
  }
}

.pill {
  padding: 3px 10px;
  border-radius: var(--radius-full);
  font-size: 12px;
  font-weight: 600;

  &.found {
    background: var(--good-soft);
    color: color-mix(in srgb, var(--good) 75%, black);
  }
  &.missing {
    background: var(--bad-soft);
    color: var(--bad);
  }
  &.photo {
    background: color-mix(in srgb, var(--warn) 15%, var(--surface));
    color: color-mix(in srgb, var(--warn) 80%, black);
  }
}

.qlist {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 820px;
  margin: 0 auto;
}

.add-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  max-width: 820px;
  margin: 18px auto 0;
  font-size: 14px;
  color: var(--muted);

  button {
    min-height: 36px;
    padding: 0 12px;
    font-size: 13px;
  }
}

/* A phone: one pane at a time, chosen by the tabs under the top bar. */
@media (max-width: 899px) {
  .phone-tabs {
    display: flex;
    gap: 4px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--line);
    background: var(--surface);

    button {
      flex: 1;
      height: 36px;
      border: 0;
      border-radius: var(--radius-md);
      background: none;
      font: inherit;
      font-size: 14px;
      color: var(--muted);
      cursor: pointer;

      &[aria-pressed="true"] {
        background: var(--sunken);
        color: var(--ink);
        font-weight: 600;
      }
    }
  }

  /* Both selectors: the wide layout's `[data-ai]` rule outranks `.workspace`
     alone, and with the rail hidden the one shown pane would land in its
     56px column (a 6px chat box at 390). */
  .workspace,
  .workspace[data-ai] {
    grid-template-columns: 1fr;
  }
  .rail {
    display: none;
  }
  .panel,
  main {
    display: none !important;
    min-width: 0;
    border-right: 0;
  }
  .panel[data-phone-show],
  main[data-phone-show] {
    display: flex !important;
  }
  main[data-phone-show] {
    display: block !important;
  }
  /* The bar: back, the name with its status as a caption under it, Save.
     The print is in the overview's Quiz options, so the name gets the row. */
  .topbar {
    height: auto;
    min-height: 60px;
    padding-block: 6px;
  }
  .unsaved,
  .spacer,
  .print {
    display: none;
  }
  .name {
    flex: 1;
    flex-direction: column;
    align-items: stretch;
    gap: 0;
  }
  .title {
    width: 100%;
    max-width: none;
    height: 44px;
    font-size: 17px;
  }
  .status,
  .status[data-status="published"] {
    padding: 0 10px;
    background: none;
    line-height: 1.2;
  }
  /* The bar's controls a finger's size, and never squeezed by the title. */
  .icon-button {
    flex: none;
    width: 44px;
    height: 44px;
  }
  .ai-button,
  .add-row button,
  .chips button {
    min-height: 44px;
  }
  /* The count on its own line, the chips together under it. */
  .summary-bar strong {
    flex-basis: 100%;
    margin-right: 0;
  }
}
</style>
