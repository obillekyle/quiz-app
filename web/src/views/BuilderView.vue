<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { onBeforeRouteLeave, useRoute } from "vue-router"
import Icon from "../components/Icon.vue"
import LogoMark from "../components/LogoMark.vue"
import PromptBox from "../components/PromptBox.vue"
import QuestionCard from "../components/QuestionCard.vue"
import { api, ApiError } from "../composables/api"
import {
  blankQuestion,
  KIND_LABEL,
  KINDS,
  refreshQuizzes,
  type FullQuiz,
  type Kind,
  type Question,
} from "../composables/quizzes"

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
  error.value = ""
  try {
    adopt(await api<FullQuiz>(`/quizzes/${id.value}/draft`, { method: "POST" }))
    refreshQuizzes()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    working.value = ""
  }
}

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
  try {
    adopt(
      await api<FullQuiz>(`/quizzes/${id.value}/chat`, {
        body: { message: text, sources },
      }),
    )
    refreshQuizzes()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    working.value = ""
    pendingText.value = ""
  }
}

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
      <span class="spacer" />
      <span v-if="dirty" class="unsaved">Unsaved changes</span>
      <!-- The print reads the saved quiz, so it waits for a save. -->
      <button
        v-if="dirty || !saved?.questions.length"
        type="button"
        class="icon-button"
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
        class="icon-button"
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
            <div class="thread" ref="thread" aria-live="polite">
              <template v-for="m in saved?.messages ?? []" :key="m.id">
                <div class="msg" :data-role="m.role">
                  <span v-if="m.role === 'ai'" class="avatar"
                    ><LogoMark :size="18"
                  /></span>
                  <div class="bubble">
                    <p>{{ m.text }}</p>
                    <ul v-if="m.meta?.files?.length" class="attached">
                      <li v-for="f in m.meta.files" :key="f">
                        <Icon name="file" :size="14" /> {{ f }}
                      </li>
                    </ul>
                    <small
                      v-if="
                        m.role === 'ai' && (m.meta?.questions || m.meta?.ms)
                      "
                    >
                      <template v-if="m.meta?.questions"
                        >{{ m.meta.questions }} questions ·
                        {{ m.meta.found }} found in {{ inFiles }} · </template
                      >{{ secs(m.meta?.ms) }}
                    </small>
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
            <PromptBox
              ref="box"
              compact
              :busy="!!working || !saved"
              placeholder="Ask for a change…"
              :hint="working ? 'The AI is working…' : ''"
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
          <div
            v-else-if="working === 'draft' && !questions.length"
            class="drafting"
          >
            <span class="dots" aria-hidden="true"><i /><i /><i /></span>
            <p>The AI is drafting your quiz. It takes about 20 seconds.</p>
          </div>
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
                >{{ counts.missing }} not found: check
                {{ counts.missing === 1 ? "it" : "them" }}</span
              >
              <span v-if="counts.photo" class="pill photo"
                >{{ counts.photo }} from photos: check by eye</span
              >
              <button v-if="!aiOpen" btn class="ai-button" @click="openAi">
                <Icon name="sparkle" :size="18" /> Edit with AI
              </button>
            </div>

            <div class="qlist">
              <QuestionCard
                v-for="(q, i) in questions"
                :key="q._key"
                v-model="questions[i]!"
                :index="i"
                :total="questions.length"
                :language="saved.quiz.language"
                :quiz-id="saved.quiz.id"
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

.drafting {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  margin-top: 18vh;
  color: var(--muted);
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

  .workspace {
    grid-template-columns: 1fr;
  }
  .rail {
    display: none;
  }
  .panel,
  main {
    display: none !important;
    border-right: 0;
  }
  .panel[data-phone-show],
  main[data-phone-show] {
    display: flex !important;
  }
  main[data-phone-show] {
    display: block !important;
  }
  .unsaved {
    display: none;
  }
  .title {
    height: 44px;
    font-size: 17px;
  }
  /* The bar's controls a finger's size, and never squeezed by the title. */
  .icon-button {
    flex: none;
    width: 44px;
    height: 44px;
  }
  .ai-button,
  .add-row button {
    min-height: 44px;
  }
}
</style>
