<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue"
import { useRoute } from "vue-router"
import ConfirmDialog from "../components/ConfirmDialog.vue"
import QuizActions from "../components/QuizActions.vue"
import QuizThumb from "../components/QuizThumb.vue"
import ShareCard from "../components/ShareCard.vue"
import Icon from "../components/Icon.vue"
import { api } from "../composables/api"
import { useAction, useFetch } from "../composables/fetch"
import {
  avatarColor,
  cap,
  initial,
  PASSING,
  PASSING_PERCENT,
} from "../composables/respondents"
import {
  BLOOM,
  edited,
  KIND_LABEL,
  releaseText,
  toldText,
  type FullQuiz,
  type Kind,
  type ResultsState,
} from "../composables/quizzes"

type Overview = {
  quiz: FullQuiz["quiz"]
  results: ResultsState
  views: number
  takers: number
  open: number
  average: number | null
  best: number | null
  finishedAt: number[]
  missed: {
    id: number
    number: number
    prompt: string
    kind: Kind
    topic: string
    answered: number
    missed: number
  }[]
  recent: {
    id: number
    name: string
    score: number
    total: number
    finishedAt: number
    rating: number | null
  }[]
  shape: {
    questions: number
    points: number
    kinds: Partial<Record<Kind, number>>
    bloom: Record<string, number>
    topics: string[]
    found: number
  }
  sources: FullQuiz["sources"]
  insight: string | null
  insightAt: number | null
  reports: {
    id: number
    reason: "wrong" | "harmful" | "copied" | "other"
    note: string | null
    /** The reported question's number in the quiz's current order. */
    question: number | null
    createdAt: number
  }[]
}

const route = useRoute()
const id = computed(() => Number(route.params.id))
const { data, error, loading, refresh } = useFetch<Overview>(
  () => `/quizzes/${id.value}/overview`,
)
const o = computed(() => data.value)

const shown = reactive({ views: 0, takers: 0, average: 0, best: 0 })
let counting = 0
watch(
  o,
  (now, before) => {
    if (!now) return
    cancelAnimationFrame(counting)
    const target = {
      views: now.views,
      takers: now.takers,
      average: now.average ?? 0,
      best: now.best ?? 0,
    }
    if (before || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      Object.assign(shown, target)
      return
    }
    const t0 = performance.now()
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 500)
      const e = 1 - (1 - k) ** 3
      shown.views = Math.round(target.views * e)
      shown.takers = Math.round(target.takers * e)
      shown.average = target.average * e
      shown.best = target.best * e
      if (k < 1) counting = requestAnimationFrame(step)
      else Object.assign(shown, target)
    }
    counting = requestAnimationFrame(step)
  },
  { immediate: true },
)
onBeforeUnmount(() => cancelAnimationFrame(counting))

const pct = (x: number | null) =>
  x == null ? "None yet" : `${Math.round(x * 100)}%`
const BLOOM_LABEL: Record<string, string> = {
  remember: "Remember",
  understand: "Understand",
  apply: "Apply",
  analyze: "Analyze",
  evaluate: "Evaluate",
  create: "Create",
}
const low = computed(
  () =>
    !!o.value?.takers && o.value.average != null && o.value.average < PASSING,
)

// ---- responses per day, the last 14 days (local time) -------------------------
const DAYS = 14
const days = computed(() => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const out = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(today)
    d.setDate(d.getDate() - (DAYS - 1 - i))
    return { date: d, n: 0 }
  })
  for (const t of o.value?.finishedAt ?? []) {
    const d = new Date(t * 1000)
    d.setHours(0, 0, 0, 0)
    const slot = out.find((x) => x.date.getTime() === d.getTime())
    if (slot) slot.n++
  }
  return out
})
const peak = computed(() => Math.max(1, ...days.value.map((d) => d.n)))
const dayLabel = (d: Date) =>
  d.toLocaleDateString("en", { month: "short", day: "numeric" })
const hovered = ref<number | null>(null)

const sharedBefore = computed(
  () =>
    !!o.value &&
    (o.value.takers > 0 ||
      o.value.open > 0 ||
      o.value.quiz.resultsReleasedAt != null),
)

// ---- the AI note ------------------------------------------------------------------
const insight = useAction(async () => {
  await api(`/quizzes/${id.value}/insight`, { method: "POST" })
  await refresh()
})

// ---- held results and unscored essays: what waits for the quiz maker ------------
const confirm = ref<InstanceType<typeof ConfirmDialog>>()
const releaseNote = ref("")
const release = useAction(async () => {
  const r = o.value?.results
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
  await refresh()
})
const waitingText = (r: ResultsState) =>
  r.waiting
    ? `${r.waiting} ${r.waiting === 1 ? "person" : "people"} left an email to be told when the results are out.`
    : "Respondents see neither their score nor the answers until you release them."

const ago = (t: number) => edited(t)
/** "Today", for a cell of its own; `ago` stays lowercase mid-sentence. */
const REASON: Record<string, string> = {
  wrong: "An answer is wrong",
  harmful: "Harmful or unsafe content",
  copied: "Copies someone else’s work",
  other: "Something else",
}
</script>

<template>
  <div class="overview">
    <p v-if="error" class="state" role="alert">
      {{ error.message }}
      <RouterLink to="/app">Back to your quizzes</RouterLink>
    </p>
    <div v-else-if="loading && !o" class="layout" aria-label="Loading the quiz">
      <div class="main-scroll">
        <div class="main" aria-hidden="true">
          <div class="skel-head">
            <div
              skeleton
              style="width: 64px; height: 64px; border-radius: var(--radius-xl)"
            />
            <div class="skel-lines">
              <div skeleton="text" style="width: 40%; height: 1.6em" />
              <div skeleton="text" style="width: 20%" />
              <div skeleton="text" style="width: 16%" />
            </div>
          </div>
          <div class="sec skel-stats">
            <div v-for="n in 4" :key="n" class="skel-lines">
              <div skeleton="text" style="width: 50%" />
              <div skeleton="text" style="width: 30%; height: 1.8em" />
            </div>
          </div>
        </div>
      </div>
      <aside class="side" aria-hidden="true">
        <section class="sec options">
          <div class="sec-head">
            <h2>Quiz options</h2>
          </div>
          <div skeleton style="height: 48px; margin-bottom: 6px" />
          <div v-for="n in 4" :key="n" class="skel-option">
            <div skeleton="text" style="width: 55%" />
          </div>
        </section>
        <section class="sec share">
          <div class="sec-head">
            <h2>Sharing</h2>
          </div>
          <div skeleton="text" style="width: 90%" />
          <div skeleton="text" style="width: 55%" />
          <div class="skel-link">
            <div skeleton style="flex: 1; height: 34px" />
            <div skeleton style="width: 64px; height: 34px" />
          </div>
          <div
            skeleton
            style="
              width: 124px;
              height: 124px;
              align-self: center;
              border-radius: var(--radius-lg);
            "
          />
        </section>
      </aside>
    </div>

    <div v-else-if="o" class="layout">
      <div class="main-scroll">
        <div class="main">
          <header class="head">
            <QuizThumb
              class="head-thumb"
              :id="o.quiz.id"
              :icon="o.quiz.icon"
              :image="o.quiz.image"
              :color="o.quiz.color"
              :title="o.quiz.title"
              :icon-size="36"
            />
            <div class="head-text">
              <div class="title-row">
                <h1>{{ o.quiz.title }}</h1>
                <!-- Archived, the link does not open: "Shared" beside "Archived" would say otherwise. -->
                <span
                  v-if="!o.quiz.archived"
                  class="status"
                  :data-status="o.quiz.status"
                  >{{
                    o.quiz.status === "published"
                      ? "Shared"
                      : sharedBefore
                        ? "Not shared"
                        : "Draft"
                  }}</span
                >
                <span v-if="o.quiz.archived" class="status">Archived</span>
                <a
                  v-if="o.reports.length"
                  href="#reports"
                  class="status reported"
                >
                  {{ o.reports.length }}
                  {{ o.reports.length === 1 ? "report" : "reports" }}
                </a>
              </div>
              <p class="sub">
                <span
                  >{{ o.shape.questions }}
                  {{ o.shape.questions === 1 ? "question" : "questions" }} ·
                  {{ o.shape.points }} points</span
                >
                <span
                  >{{ o.quiz.language === "fil" ? "Filipino" : "English" }} ·
                  Edited {{ ago(o.quiz.updatedAt) }}</span
                >
              </p>
            </div>
          </header>

          <!-- What waits for the quiz maker: held results, unscored essays. -->
          <section
            v-if="
              o.results.held ||
              o.results.waiting ||
              o.results.pending ||
              releaseNote
            "
            class="sec todo"
            aria-label="Waiting for you"
          >
            <div
              v-if="o.results.held || o.results.waiting || releaseNote"
              class="todo-row"
            >
              <span class="todo-icon" aria-hidden="true"
                ><Icon name="mail" :size="18"
              /></span>
              <span class="what">
                <strong>{{
                  o.results.held
                    ? "Results are held"
                    : o.results.waiting
                      ? "Some respondents have not been told"
                      : "Results released"
                }}</strong>
                <span v-if="o.results.held || o.results.waiting">{{
                  waitingText(o.results)
                }}</span>
                <span v-if="releaseNote" class="told" role="status">{{
                  releaseNote
                }}</span>
                <span v-if="release.error.value" class="error" role="alert">{{
                  release.error.value.message
                }}</span>
              </span>
              <button
                v-if="o.results.held || o.results.waiting"
                btn="primary"
                type="button"
                class="todo-action"
                :disabled="release.pending.value"
                @click="release.run()"
              >
                {{ release.pending.value ? "Releasing…" : "Release results" }}
              </button>
            </div>
            <div v-if="o.results.pending" class="todo-row">
              <span class="todo-icon" aria-hidden="true"
                ><Icon name="edit" :size="18"
              /></span>
              <span class="what">
                <strong
                  >{{ o.results.pending }}
                  {{ o.results.pending === 1 ? "essay waits" : "essays wait" }}
                  for your score</strong
                >
                <span>{{
                  o.results.pending === 1
                    ? "It counts as 0 in the respondent's total until you score it."
                    : "Each counts as 0 in its respondent's total until you score it."
                }}</span>
              </span>
              <RouterLink
                v-if="o.results.pendingIn"
                btn
                class="todo-action"
                :to="`/app/quiz/${id}/responses/${o.results.pendingIn}`"
                >{{
                  o.results.pending === 1 ? "Score it" : "Score them"
                }}</RouterLink
              >
            </div>
          </section>

          <section class="sec stats" aria-label="Numbers">
            <div class="stat">
              <span>Views</span>
              <strong>{{ shown.views }}</strong>
            </div>
            <div class="stat">
              <span>Quiz takers</span>
              <strong>{{ shown.takers }}</strong>
              <small v-if="o.open">plus {{ o.open }} still answering</small>
            </div>
            <div class="stat" :data-low="low || undefined">
              <span>Average score</span>
              <strong :data-none="o.average == null || undefined">{{
                pct(o.average == null ? null : shown.average)
              }}</strong>
              <small v-if="low">Under {{ PASSING_PERCENT }}% passing</small>
            </div>
            <div class="stat">
              <span>Highest</span>
              <strong :data-none="o.best == null || undefined">{{
                pct(o.best == null ? null : shown.best)
              }}</strong>
            </div>
          </section>

          <section class="sec chart-sec">
            <div class="sec-head">
              <h2>Responses, last 14 days</h2>
              <span class="muted"
                >{{ days.reduce((s, d) => s + d.n, 0) }} in total</span
              >
            </div>
            <p v-if="!o.takers" class="empty">
              No responses yet.
              {{
                o.quiz.status === "published"
                  ? "Share the link to get some."
                  : "Share the quiz to get some."
              }}
            </p>
            <div
              v-else
              class="chart"
              role="img"
              :aria-label="`Responses per day: ${days.map((d) => `${dayLabel(d.date)} ${d.n}`).join(', ')}`"
            >
              <div class="bars">
                <div
                  v-for="(d, i) in days"
                  :key="i"
                  class="slot"
                  tabindex="0"
                  @mouseenter="hovered = i"
                  @mouseleave="hovered = null"
                  @focus="hovered = i"
                  @blur="hovered = null"
                >
                  <div
                    class="bar"
                    :style="{
                      height: d.n ? `${(d.n / peak) * 100}%` : '2px',
                      '--i': i,
                    }"
                    :data-zero="!d.n || undefined"
                  />
                  <span v-if="hovered === i" class="tip" role="tooltip"
                    >{{ dayLabel(d.date) }}: {{ d.n }}
                    {{ d.n === 1 ? "response" : "responses" }}</span
                  >
                </div>
              </div>
              <div class="axis" aria-hidden="true">
                <span>{{ dayLabel(days[0]!.date) }}</span>
                <span>Today</span>
              </div>
            </div>
          </section>

          <section class="sec missed">
            <div class="sec-head">
              <h2>Most missed questions</h2>
            </div>
            <p v-if="!o.missed.length" class="empty">
              {{
                o.takers
                  ? "Nobody has missed a question yet."
                  : "Missed questions show here once people answer."
              }}
            </p>
            <ol v-else>
              <li v-for="m in o.missed" :key="m.id">
                <div class="q">
                  <span class="qnum">{{ m.number }}</span>
                  <span class="qtext">{{ m.prompt }}</span>
                </div>
                <div
                  class="meter"
                  :aria-label="`${m.missed} of ${m.answered} missed`"
                >
                  <div class="track">
                    <div
                      class="fill"
                      :style="{ width: `${(m.missed / m.answered) * 100}%` }"
                    />
                  </div>
                  <span
                    >Missed by {{ m.missed }} of the {{ m.answered }} who
                    answered</span
                  >
                </div>
              </li>
            </ol>

            <div v-if="o.takers" class="note">
              <div class="note-head">
                <strong
                  ><Icon name="sparkle" :size="16" /> What to teach
                  again</strong
                >
                <button
                  btn
                  class="small"
                  :disabled="insight.pending.value"
                  @click="insight.run()"
                >
                  {{
                    insight.pending.value
                      ? "Writing…"
                      : o.insight
                        ? "Rewrite the note"
                        : "Ask the AI for a note"
                  }}
                </button>
              </div>
              <p v-if="o.insight">{{ o.insight }}</p>
              <p v-else class="muted">
                The AI reads which questions people missed, with no names, and
                suggests what to go over.
              </p>
              <small v-if="o.insight"
                >Written by the AI {{ ago(o.insightAt!) }} from anonymous
                counts. Check it against what you saw in class.</small
              >
              <p v-if="insight.error.value" class="error" role="alert">
                {{ insight.error.value.message }}
              </p>
            </div>
          </section>

          <!-- Reports from the flag on the quiz's pages: the anomaly to act on. -->
          <section v-if="o.reports.length" id="reports" class="sec reports">
            <div class="sec-head">
              <h2>Reports from respondents</h2>
              <span class="muted">Anonymous</span>
            </div>
            <ul>
              <li v-for="r in o.reports" :key="r.id">
                <span class="flag-dot" aria-hidden="true"
                  ><Icon name="flag" :size="16"
                /></span>
                <span class="what">
                  <strong>{{ REASON[r.reason] }}</strong>
                  <span v-if="r.question" class="about"
                    >About question {{ r.question }}</span
                  >
                  <span v-if="r.note">{{ r.note }}</span>
                </span>
                <span class="when">{{ cap(ago(r.createdAt)) }}</span>
              </li>
            </ul>
          </section>

          <section class="sec recent">
            <div class="sec-head">
              <h2>Recent respondents</h2>
              <a
                v-if="o.takers"
                :href="`/api/quizzes/${id}/responses.csv`"
                :download="`${o.quiz.title}-responses.csv`"
                btn="quiet"
                class="small"
              >
                <Icon name="download" :size="16" /> Download CSV
              </a>
            </div>
            <RouterLink
              v-if="o.takers > o.recent.length"
              :to="`/app/quiz/${id}/responses`"
              class="view-all"
            >
              View all {{ o.takers }} responses
              <Icon name="forward" :size="18" />
            </RouterLink>
            <p v-if="!o.recent.length" class="empty">
              Nobody has finished the quiz yet.
            </p>
            <ul v-else>
              <li v-for="r in o.recent" :key="r.id">
                <RouterLink :to="`/app/quiz/${id}/responses/${r.id}`">
                  <span
                    class="avatar"
                    :style="{ background: avatarColor(r.name) }"
                    >{{ initial(r.name) }}</span
                  >
                  <span class="who">{{ r.name }}</span>
                  <span class="score">{{ r.score }} / {{ r.total }}</span>
                  <span class="when">{{ cap(ago(r.finishedAt)) }}</span>
                </RouterLink>
              </li>
            </ul>
          </section>
        </div>
      </div>
      <aside class="side" aria-label="The quiz">
        <!-- The quiz, from the design: its color, and the way into the editor. -->
        <section class="sec options">
          <div class="sec-head">
            <h2>Quiz options</h2>
          </div>
          <QuizActions
            :quiz-id="id"
            :title="o.quiz.title"
            :archived="o.quiz.archived"
            :questions="o.shape.questions"
            @changed="refresh"
          />
        </section>

        <section class="sec share">
          <div class="sec-head">
            <h2>Sharing</h2>
            <RouterLink :to="`/app/quiz/${id}/sharing`" class="more"
              >More</RouterLink
            >
          </div>
          <ShareCard
            :quiz-id="id"
            :status="o.quiz.status"
            :share-code="o.quiz.shareCode"
            :questions="o.shape.questions"
            :show-results="o.quiz.showResults"
            :show-hints="o.quiz.showHints"
            :feedback="o.quiz.feedback"
            :allow-retake="o.quiz.allowRetake"
            :archived="o.quiz.archived"
            @changed="refresh"
          />
        </section>

        <section class="sec details">
          <div class="sec-head">
            <h2>Details</h2>
          </div>
          <dl>
            <dt>Questions</dt>
            <dd>
              <span v-for="(n, k) in o.shape.kinds" :key="k" class="chip"
                >{{ n }} {{ KIND_LABEL[k as Kind] }}</span
              >
            </dd>
            <dt>Levels of thinking</dt>
            <dd>
              <template v-for="b in BLOOM" :key="b">
                <span v-if="o.shape.bloom[b]" class="chip"
                  >{{ o.shape.bloom[b] }} {{ BLOOM_LABEL[b] }}</span
                >
              </template>
            </dd>
            <dt>Topics</dt>
            <dd>{{ o.shape.topics.join(", ") || "None yet" }}</dd>
            <dt>Grounded</dt>
            <dd>
              {{ o.shape.found }} of {{ o.shape.questions }} quotes found in the
              material
            </dd>
            <dt>Material</dt>
            <dd>
              {{
                o.sources.map((s) => s.name).join(", ") ||
                "None: from the request alone"
              }}
            </dd>
          </dl>
        </section>
      </aside>
    </div>
    <ConfirmDialog ref="confirm" />
  </div>
</template>

<style scoped>
.overview {
  flex: 1;
  container-type: inline-size;
}

.state {
  padding: 64px 16px;
  text-align: center;
  color: var(--muted);
}

.skel-head {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 0 20px;
}
.skel-lines {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
}
.skel-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}
.skel-option {
  display: flex;
  align-items: center;
  min-height: 44px;
}
.skel-link {
  display: flex;
  gap: 8px;
}

.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  height: calc(100dvh - var(--topbar-h));
}
.main-scroll {
  min-width: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.main {
  width: min(100%, var(--page-w));
  margin-inline: auto;
  padding: 28px var(--page-pad) 64px;
}

.side {
  overflow-y: auto;
  border-left: 1px solid var(--line);
  background:
    linear-gradient(var(--surface) 30%, transparent) center top / 100% 48px
      no-repeat local,
    linear-gradient(transparent, var(--surface) 70%) center bottom / 100% 48px
      no-repeat local,
    linear-gradient(rgb(0 0 0 / 0.1), transparent) center top / 100% 14px
      no-repeat scroll,
    linear-gradient(transparent, rgb(0 0 0 / 0.1)) center bottom / 100% 14px
      no-repeat scroll,
    var(--surface);
}

.sec {
  padding: 24px 0;
  border-top: 1px solid color-mix(in srgb, var(--ink) 9%, transparent);
}
.side .sec {
  padding: 18px 20px;
  border-top-color: var(--line);
}

.crumbs {
  display: flex;
  gap: 8px;
  font-size: 14px;
  color: var(--muted);

  a {
    color: inherit;
    text-decoration: none;
  }
  a:hover {
    color: var(--ink);
  }
  [aria-current] {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.head {
  display: flex;
  align-items: center;
  gap: 16px;
  padding-bottom: 20px;
}
/* The quiz's picture: its cover, else its icon, else its color. */
.head-thumb {
  flex: none;
  width: 64px;
  height: 64px;
  border-radius: var(--radius-xl);
}
.head-text {
  min-width: 0;
}

/* ---- what waits for the quiz maker ---- */
.todo {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.todo-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.todo-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--accent) 12%, var(--surface));
  color: var(--accent);
}
.todo-action {
  flex: none;
  min-height: 44px;
  font-size: 14px;
}
.told {
  color: var(--good) !important;
  font-weight: 600;
}

.title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 8px;

  h1 {
    margin: 0;
    font-size: clamp(24px, 3vw, 30px);
    letter-spacing: -0.02em;
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

/* Two short lines, one middle dot each. */
.sub {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 6px 0 0;
  font-size: 14px;
  color: var(--muted);
}

.sec-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;

  h2 {
    margin: 0;
    font-size: 16px;
  }
}

.muted {
  font-size: 13px;
  color: var(--muted);
}

.empty {
  margin: 0;
  font-size: 14px;
  color: var(--muted);
}

.error {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--bad);
}

/* ---- the numbers: a label over each value, as in the CRM's row ---- */
.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;

  span {
    font-size: 13px;
    color: var(--muted);
  }
  strong {
    font: 650 28px/1.15 var(--font-heading);
    letter-spacing: -0.02em;
    /* The count runs in place: every digit the same width. */
    font-variant-numeric: tabular-nums;

    &[data-none] {
      padding-top: 8px;
      font: 500 16px/1.4 var(--font);
      letter-spacing: 0;
      color: var(--muted);
    }
  }
  small {
    font-size: 12px;
    color: var(--muted);
  }
  &[data-low] strong,
  &[data-low] small {
    color: var(--bad);
  }
}

/* ---- responses per day: thin bars, rounded tops, a 2px gap ---- */
.chart {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bars {
  display: grid;
  grid-template-columns: repeat(14, 1fr);
  gap: 2px;
  height: 150px;
  border-bottom: 1px solid color-mix(in srgb, var(--ink) 12%, transparent);
}
.slot {
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  outline: none;
  cursor: default;

  &:hover,
  &:focus-visible {
    background: color-mix(in srgb, var(--ink) 4%, transparent);
  }
}
.bar {
  width: min(100%, 22px);
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  background: var(--chart);
  transform-origin: bottom;
  animation: grow-up 400ms var(--ease-emphasized-decelerate) both;
  animation-delay: calc(var(--i, 0) * 20ms);

  &[data-zero] {
    background: color-mix(in srgb, var(--ink) 10%, transparent);
  }
}
.tip {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 50%;
  translate: -50% 0;
  padding: 4px 8px;
  border-radius: var(--radius-tile);
  background: var(--ink);
  color: var(--surface);
  font-size: 12px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 1;
}
.axis {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--muted);
}

@keyframes grow-up {
  from {
    scale: 1 0;
  }
}

/* ---- most missed ---- */
.missed ol {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.q {
  display: flex;
  gap: 10px;
  align-items: baseline;
  font-size: 14px;
}
.qnum {
  flex: none;
  min-width: 24px;
  padding: 1px 6px;
  border-radius: var(--radius-tile);
  background: color-mix(in srgb, var(--ink) 7%, transparent);
  font-size: 12px;
  font-weight: 600;
  text-align: center;
}
.qtext {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.meter {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 6px 0 0 34px;
  font-size: 12px;
  color: var(--muted);
}
.track {
  flex: 1;
  height: 8px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--ink) 8%, transparent);
}
.fill {
  height: 100%;
  border-radius: var(--radius-sm);
  background: var(--chart);
}

/* The AI's note keeps a tint: it is the one thing here the AI wrote. */
.note {
  margin-top: 16px;
  padding: 14px 16px;
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--accent) 7%, var(--surface));

  p {
    margin: 8px 0 0;
    font-size: 14px;
    line-height: 1.55;
  }
  small {
    display: block;
    margin-top: 8px;
    font-size: 12px;
    color: var(--muted);
  }
}
.note-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;

  strong {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
  }
}
.small {
  min-height: 34px;
  padding: 0 12px;
  font-size: 13px;
}

/* ---- reports ---- */
.reported {
  background: color-mix(in srgb, var(--bad) 12%, var(--surface));
  color: var(--bad);
  text-decoration: none;
}
.reports ul {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.reports li {
  display: flex;
  align-items: start;
  gap: 12px;
}
.flag-dot {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--bad) 12%, var(--surface));
  color: var(--bad);
}
.what {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  font-size: 14px;

  span {
    color: color-mix(in srgb, var(--ink) 75%, transparent);
    overflow-wrap: anywhere;
  }
  .about {
    font-size: 13px;
    font-weight: 600;
  }
}

.more {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
}

/* ---- recent respondents ---- */
.view-all {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 44px;
  margin: 4px -8px 0;
  padding: 0 8px;
  border-radius: var(--radius-md);
  color: var(--accent);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;

  &:hover {
    background: color-mix(in srgb, var(--ink) 5%, transparent);
  }
}
.recent ul {
  display: flex;
  flex-direction: column;
  margin: 0 -8px;
  padding: 0;
  list-style: none;
}
.recent a {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
  color: var(--ink);
  text-decoration: none;
  border-radius: var(--radius-md);

  &:hover {
    background: color-mix(in srgb, var(--ink) 5%, transparent);
  }
}
.avatar {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  color: white;
  font-weight: 650;
  font-size: 14px;
}
.who {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.score {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.when {
  width: 92px;
  text-align: right;
  font-size: 13px;
  color: var(--muted);
}

/* ---- sharing ---- */
.share {
  display: flex;
  flex-direction: column;
  gap: 10px;

  .sec-head {
    margin-bottom: 0;
  }
  p {
    margin: 0;
  }
}
.link {
  display: flex;
  gap: 8px;

  input {
    flex: 1;
    min-width: 0;
    height: 34px;
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
  width: 160px;
  padding: 6px;
  border-radius: var(--radius-lg);
  background: white;

  :deep(svg) {
    display: block;
    width: 100%;
    height: auto;
  }
}
.stop {
  align-self: center;
}

/* ---- details ---- */
dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px 14px;
  margin: 0;
  font-size: 14px;
}
dt {
  color: var(--muted);
}
dd {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
}
.chip {
  padding: 1px 8px;
  border-radius: var(--radius-full);
  background: var(--sunken);
  font-size: 12px;
}

/* ---- options ---- */
.options {
  display: flex;
  flex-direction: column;

  .sec-head {
    margin-bottom: 6px;
  }
}
.option {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 44px;
  margin: 0 -8px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--radius-md);
  background: none;
  font: inherit;
  font-size: 14px;
  color: var(--ink);
  text-align: left;
  text-decoration: none;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--hover);
  }
  &.danger {
    color: var(--bad);
  }
}

/* On a phone, the two small text controls reach 44 px by padding alone. */
@container (max-width: 900px) {
  .more {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    margin: -12px -10px -12px 0;
    padding: 0 10px;
  }
  .small {
    min-height: 44px;
  }
}

@container (max-width: 560px) {
  .todo-row {
    flex-wrap: wrap;
  }
  .todo-row .what {
    flex-basis: calc(100% - 44px);
  }
  .todo-action {
    margin-left: 44px;
  }
}

@container (max-width: 900px) {
  .layout {
    display: flex;
    flex-direction: column;
    height: auto;
    align-items: stretch;
    padding: 20px 16px 56px;
  }
  .main-scroll,
  .main,
  .side {
    display: contents;
  }
  .head {
    order: 0;
  }
  .options {
    order: 8;
    margin-bottom: 20px;
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .stats {
    order: 2;
    grid-template-columns: repeat(2, 1fr);
  }
  .recent {
    order: 3;
  }
  .chart-sec {
    order: 4;
  }
  .missed {
    order: 5;
  }
  .share {
    order: 6;
  }
  .details {
    order: 7;
  }
  .options {
    order: 8;
  }
  .side .sec {
    padding: 24px 0;
    border-top-color: color-mix(in srgb, var(--ink) 9%, transparent);
  }
}
</style>
