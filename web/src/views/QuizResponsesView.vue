<script setup lang="ts">
import { computed, ref } from "vue"
import { useRoute } from "vue-router"
import Icon from "../components/Icon.vue"
import QuizHead from "../components/QuizHead.vue"
import { useFetch } from "../composables/fetch"
import {
  avatarColor,
  below,
  cap,
  initial,
  percent,
} from "../composables/respondents"
import { edited, type FullQuiz } from "../composables/quizzes"

type Row = {
  id: number
  name: string
  /** The section typed under the name ("7 Sampaguita"), if any. */
  section: string | null
  status: "open" | "finished"
  score: number
  total: number
  finishedAt: number | null
  rating: number | null
  /** Essays waiting for the quiz maker's score. */
  pending: number
}

const route = useRoute()
const id = computed(() => Number(route.params.id))
const { data: quiz } = useFetch<FullQuiz>(() => `/quizzes/${id.value}`)
const { data, error, loading } = useFetch<{ responses: Row[] }>(
  () => `/quizzes/${id.value}/responses`,
)

const all = computed(() => data.value?.responses ?? [])
const finished = computed(
  () => all.value.filter((r) => r.status === "finished").length,
)
const open = computed(() => all.value.length - finished.value)
const pending = computed(() =>
  all.value.reduce((s, r) => s + (r.pending ?? 0), 0),
)
const essays = (n: number) => `${n} ${n === 1 ? "essay" : "essays"} to score`
const find = ref("")

// ---- one section, or all: the select lists the sections present ------------------
const section = ref("")
const sections = computed(() =>
  [...new Set(all.value.flatMap((r) => (r.section ? [r.section] : [])))].sort(
    (a, b) => a.localeCompare(b, undefined, { numeric: true }),
  ),
)

// ---- the order: newest, by name, or by score either way ---------------------------
type Sort = "newest" | "name" | "high" | "low"
const sort = ref<Sort>("newest")
const ratio = (r: Row) => (r.total ? r.score / r.total : 0)
// A score order puts the ones still answering last: their score is not in yet.
const done = (r: Row) => (r.status === "finished" ? 1 : 0)
const ORDER: Record<Sort, (a: Row, b: Row) => number> = {
  newest: (a, b) => b.id - a.id,
  name: (a, b) => a.name.localeCompare(b.name) || b.id - a.id,
  high: (a, b) => done(b) - done(a) || ratio(b) - ratio(a) || b.id - a.id,
  low: (a, b) => done(b) - done(a) || ratio(a) - ratio(b) || b.id - a.id,
}
const rows = computed(() => {
  const q = find.value.trim().toLowerCase()
  const s = section.value
  const found = all.value.filter(
    (r) => (!s || r.section === s) && (!q || r.name.toLowerCase().includes(q)),
  )
  return [...found].sort(ORDER[sort.value])
})
/** When the search and the section leave nothing: both named, or just the name. */
const nothing = computed(() => {
  const named = `named “${find.value.trim()}”`
  return section.value
    ? `No respondent in ${section.value} is ${named}.`
    : `No respondent is ${named}.`
})

const csvHref = computed(() => `/api/quizzes/${id.value}/responses.csv`)
const csvName = computed(
  () => `${quiz.value?.quiz.title ?? "quiz"}-responses.csv`,
)

const pct = (r: Row) => percent(r.score, r.total)
const low = (r: Row) => below(r.score, r.total)
</script>

<template>
  <div class="page">
    <QuizHead
      v-if="quiz"
      :quiz-id="id"
      :quiz="quiz.quiz.title"
      page="Respondents"
      :status="quiz.quiz.status"
      :archived="quiz.quiz.archived"
    />

    <p v-if="error" class="state" role="alert">{{ error.message }}</p>
    <ul
      v-else-if="loading && !data"
      class="rows"
      stack
      aria-label="Loading the responses"
    >
      <li v-for="n in 5" :key="n" class="row-skel" aria-hidden="true">
        <div skeleton="round" style="width: 34px; height: 34px" />
        <div skeleton="text" style="width: 30%" />
        <div skeleton="text" style="width: 10%; margin-left: auto" />
      </li>
    </ul>
    <template v-else-if="data">
      <div v-if="all.length" class="bar">
        <p class="summary">
          {{ finished }} finished<template v-if="open"
            >, {{ open }} still answering</template
          ><template v-if="pending">, {{ essays(pending) }}</template
          >.
        </p>
        <div class="tools">
          <select v-model="sort" class="sort" aria-label="Sort the respondents">
            <option value="newest">Newest</option>
            <option value="name">Name</option>
            <option value="high">Score high to low</option>
            <option value="low">Score low to high</option>
          </select>
          <select
            v-if="sections.length"
            v-model="section"
            class="sort"
            aria-label="Show one section"
          >
            <option value="">All sections</option>
            <option v-for="s in sections" :key="s" :value="s">{{ s }}</option>
          </select>
          <label class="find">
            <Icon name="search" :size="18" />
            <input
              v-model="find"
              type="search"
              placeholder="Find a name"
              aria-label="Find a respondent by name"
            />
          </label>
          <a :href="csvHref" :download="csvName" btn class="csv">
            <Icon name="download" :size="18" /> Download CSV
          </a>
        </div>
      </div>

      <div v-if="!all.length" class="empty">
        <Icon name="people" :size="32" />
        <p>Nobody has answered yet.</p>
        <RouterLink :to="`/app/quiz/${id}/sharing`" btn
          >Share the quiz</RouterLink
        >
      </div>
      <p v-else-if="!rows.length" class="state">{{ nothing }}</p>

      <ul v-else class="rows" stack>
        <li v-for="r in rows" :key="r.id">
          <RouterLink :to="`/app/quiz/${id}/responses/${r.id}`">
            <span class="avatar" :style="{ background: avatarColor(r.name) }">{{
              initial(r.name)
            }}</span>
            <span class="who">
              <span class="name">{{ r.name }}</span>
              <small v-if="r.section" class="section">{{ r.section }}</small>
            </span>
            <span v-if="r.pending" class="todo">{{ essays(r.pending) }}</span>
            <template v-if="r.status === 'finished'">
              <span class="score" :data-low="low(r) || undefined"
                >{{ r.score }} / {{ r.total }}</span
              >
              <span class="pct" :data-low="low(r) || undefined">{{
                pct(r)
              }}</span>
              <span class="when">{{
                r.finishedAt ? cap(edited(r.finishedAt)) : ""
              }}</span>
            </template>
            <span v-else class="open">Still answering</span>
          </RouterLink>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.page {
  width: min(100%, var(--page-w));
  padding: 28px var(--page-pad) 64px;
}
.state {
  padding: 40px 0;
  text-align: center;
  color: var(--muted);
}
.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.summary {
  margin: 0;
  font-size: 14px;
  color: var(--muted);
}
.tools {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
.sort {
  height: 40px;
  padding: 0 34px 0 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-full);
  background-color: var(--surface);
  font: inherit;
  font-size: 14px;
  color: var(--ink);
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid var(--accent);
  }
}
.csv {
  min-height: 40px;
  padding: 0 16px;
  border-radius: var(--radius-full);
  font-size: 14px;
}
.find {
  display: flex;
  align-items: center;
  gap: 8px;
  width: min(100%, 240px);
  height: 40px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-full);
  background: var(--surface);
  color: var(--muted);

  &:focus-within {
    outline: 2px solid var(--accent);
  }
  input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: 0;
    background: none;
    font: inherit;
    color: var(--ink);
    outline: none;
  }
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 56px 0;
  color: var(--muted);

  p {
    margin: 0;
  }
}
.rows {
  a {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 60px;
    padding: 10px 16px;
    border-radius: inherit;
    color: var(--ink);
    text-decoration: none;

    &:hover {
      background: color-mix(in srgb, var(--ink) 5%, transparent);
    }
  }
}
.row-skel {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 60px;
  padding: 10px 16px;
}
.avatar {
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  color: white;
  font-weight: 650;
}
.who {
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
  min-height: 40px;

  .name,
  .section {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name {
    line-height: 22px;
  }
  .section {
    font-size: 13px;
    line-height: 18px;
    color: var(--muted);
  }
}
/* Essays waiting for a score: the one thing on the row to act on. */
.todo {
  flex: none;
  padding: 2px 10px;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--warn) 16%, var(--surface));
  color: color-mix(in srgb, var(--warn) 80%, black);
  font-size: 12px;
  font-weight: 600;
}
.score {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.pct {
  width: 48px;
  text-align: right;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}
.when,
.open {
  width: 110px;
  text-align: right;
  font-size: 13px;
  color: var(--muted);
}
.open {
  color: color-mix(in srgb, var(--warn) 80%, black);
}
.pct[data-low] {
  color: var(--bad);
  font-weight: 600;
}

@media (max-width: 560px) {
  .tools {
    flex: none;
    width: 100%;
  }
  .sort,
  .csv {
    flex: 1;
    height: 44px;
    min-height: 44px;
  }
  .find {
    width: 100%;
    height: 44px;
  }
  /* The percentage is gone at this width, so the score carries the mark. */
  .score[data-low] {
    color: var(--bad);
  }
  .pct {
    display: none;
  }
  .when,
  .open {
    width: auto;
  }
}
</style>
