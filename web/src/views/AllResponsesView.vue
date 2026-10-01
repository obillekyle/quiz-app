<script setup lang="ts">
import { computed, ref } from "vue"
import Icon from "../components/Icon.vue"
import { useFetch } from "../composables/fetch"
import { edited } from "../composables/quizzes"

/**
 * The sidebar's Responses: everyone who answered any of the user's quizzes,
 * people still answering first, then the finished ones, newest first. Each
 * row opens that person's answers.
 */
type Row = {
  id: number
  quizId: number
  quiz: string
  name: string
  status: "open" | "finished"
  score: number
  total: number
  finishedAt: number | null
}

const { data, error, loading } = useFetch<{
  responses: Row[]
  quizzes: number
}>("/responses")
const all = computed(() => data.value?.responses ?? [])
const finished = computed(
  () => all.value.filter((r) => r.status === "finished").length,
)
const open = computed(() => all.value.length - finished.value)
/** "6 finished, 3 still answering, across 2 quizzes." */
const summary = computed(() => {
  const n = data.value?.quizzes ?? 0
  const across = `across ${n} ${n === 1 ? "quiz" : "quizzes"}.`
  return open.value
    ? `${finished.value} finished, ${open.value} still answering, ${across}`
    : `${finished.value} finished ${across}`
})
const find = ref("")
const rows = computed(() => {
  const q = find.value.trim().toLowerCase()
  return q
    ? all.value.filter(
        (r) =>
          r.name.toLowerCase().includes(q) || r.quiz.toLowerCase().includes(q),
      )
    : all.value
})

const pct = (r: Row) =>
  r.total ? `${Math.round((r.score / r.total) * 100)}%` : ""
/** Under the passing mark (75%), as the overview marks its average. */
const low = (r: Row) => !!r.total && r.score / r.total < 0.75
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const initial = (name: string) => (name.trim()[0] ?? "?").toUpperCase()
const AVATARS = [
  "#6b276c",
  "#2f6fdb",
  "#5c3715",
  "#2e7d32",
  "#c62828",
  "#ef6c00",
]
const avatarColor = (name: string) =>
  AVATARS[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % AVATARS.length]
</script>

<template>
  <div class="page">
    <h1>Responses</h1>
    <p v-if="error" class="state" role="alert">{{ error.message }}</p>
    <ul
      v-else-if="loading && !data"
      class="rows"
      stack
      aria-label="Loading the responses"
    >
      <li v-for="n in 6" :key="n" class="row-skel" aria-hidden="true">
        <div skeleton="round" style="width: 34px; height: 34px" />
        <div skeleton="text" style="width: 30%" />
        <div skeleton="text" style="width: 10%; margin-left: auto" />
      </li>
    </ul>

    <template v-else-if="data">
      <div v-if="all.length" class="bar">
        <p class="summary">{{ summary }}</p>
        <label class="find">
          <Icon name="search" :size="18" />
          <input
            v-model="find"
            type="search"
            placeholder="Find a name or a quiz"
            aria-label="Find a respondent or a quiz"
          />
        </label>
      </div>

      <div v-if="!all.length" class="empty">
        <Icon name="responses" :size="32" />
        <p>
          Nobody has answered a quiz yet. A shared quiz's answers show here.
        </p>
        <RouterLink to="/app" btn>Go to your quizzes</RouterLink>
      </div>
      <p v-else-if="!rows.length" class="state">
        Nothing matches “{{ find.trim() }}”.
      </p>

      <ul v-else class="rows" stack>
        <li v-for="r in rows" :key="r.id">
          <RouterLink :to="`/app/quiz/${r.quizId}/responses/${r.id}`">
            <span class="avatar" :style="{ background: avatarColor(r.name) }">{{
              initial(r.name)
            }}</span>
            <span class="who">
              <strong>{{ r.name }}</strong>
              <span>{{ r.quiz }}</span>
            </span>
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
  width: min(100%, 1120px);
  padding: 28px var(--page-pad) 64px;

  h1 {
    margin: 0 0 16px;
    font-size: 26px;
    font-weight: 650;
    letter-spacing: -0.02em;
  }
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
.find {
  display: flex;
  align-items: center;
  gap: 8px;
  width: min(100%, 280px);
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
  text-align: center;
  color: var(--muted);

  p {
    margin: 0;
  }
}
.rows a {
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
  min-width: 0;

  strong,
  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  strong {
    font-weight: 400;
  }
  span {
    font-size: 13px;
    color: var(--muted);
  }
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

  &[data-low] {
    color: var(--bad);
    font-weight: 600;
  }
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

@media (max-width: 560px) {
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
