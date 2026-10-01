<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import ConfirmDialog from "../components/ConfirmDialog.vue"
import Icon from "../components/Icon.vue"
import { api } from "../composables/api"
import { pageCrumb } from "../composables/crumb"
import { useAction, useFetch } from "../composables/fetch"
import { below } from "../composables/respondents"
import { edited, KIND_LABEL, type Question } from "../composables/quizzes"

type Answer = {
  id: number
  choice: number | null
  text: string | null
  correct: boolean
  score: number
  verdict: string | null
  byAi: boolean
  overridden: boolean
  /** An essay waiting for the maker's score (essay checking by AI is off). */
  pending: boolean
}
type Detail = {
  response: {
    id: number
    name: string
    /** The section typed under the name ("7 Sampaguita"), if any. */
    section: string | null
    status: "open" | "finished"
    score: number
    total: number
    finishedAt: number | null
    /** The respondent got a shuffled paper; the items come in its order. */
    shuffled: boolean
  }
  items: {
    question: Question & { id: number }
    /** The original option indices in the order the respondent saw them. */
    order: number[] | null
    /** The correct answer's letter as the respondent saw it. */
    key: string | null
    answer: Answer | null
  }[]
}

const route = useRoute()
const router = useRouter()
const quizId = computed(() => Number(route.params.id))
const rid = computed(() => Number(route.params.rid))
const { data, error, loading, refresh } = useFetch<Detail>(
  () => `/quizzes/${quizId.value}/responses/${rid.value}`,
)

// The top bar's trail ends with the respondent's name while the page is open.
watch(
  () => data.value?.response.name,
  (n) => (pageCrumb.value = n ?? null),
  { immediate: true },
)
onBeforeUnmount(() => (pageCrumb.value = null))

/** Under the passing mark (75%), as the overview marks its average. */
const low = computed(() => {
  const r = data.value?.response
  return !!r && below(r.score, r.total)
})

const confirm = ref<InstanceType<typeof ConfirmDialog>>()
/** Deletes the response once confirmed, then shows the quiz's responses. */
const remove = useAction(async () => {
  const ok = await confirm.value?.ask({
    title: `Delete ${data.value?.response.name}’s response?`,
    text: "Their answers and score go with it. This cannot be undone.",
    action: "Delete response",
    danger: true,
  })
  if (!ok) return
  await api(`/quizzes/${quizId.value}/responses/${rid.value}`, {
    method: "DELETE",
  })
  await router.replace(`/app/quiz/${quizId.value}/responses`)
})

const LETTERS = "ABCDEF"

type Item = Detail["items"][number]
/** A question's options as the respondent saw them: shuffled papers keep their order and letters. */
const shown = (it: Item) =>
  (it.order ?? it.question.choices.map((_, i) => i)).map((i) => ({
    i,
    c: it.question.choices[i]!,
  }))
const pending = computed(
  () => data.value?.items.filter((i) => i.answer?.pending).length ?? 0,
)

/** The quiz maker's own score for an answer the AI checked or scored. */
const editing = ref<number | null>(null)
const draft = ref(0)
const saveError = ref("")
function startEdit(a: Answer) {
  editing.value = a.id
  draft.value = a.score
  saveError.value = ""
}
async function saveScore(a: Answer) {
  try {
    await api(
      `/quizzes/${quizId.value}/responses/${rid.value}/answers/${a.id}`,
      { method: "PATCH", body: { score: draft.value } },
    )
    editing.value = null
    await refresh()
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e)
  }
}
</script>

<template>
  <div class="response">
    <p v-if="error" class="state" role="alert">
      {{ error.message }}
      <RouterLink :to="`/app/quiz/${quizId}`">Back to the quiz</RouterLink>
    </p>
    <div
      v-else-if="loading && !data"
      class="skel"
      aria-label="Loading the response"
    >
      <div class="skel-head" aria-hidden="true">
        <div skeleton="text" style="width: 30%; height: 1.6em" />
        <div skeleton="text" style="width: 22%" />
        <div skeleton="text" style="width: 18%" />
      </div>
      <div v-for="n in 3" :key="n" class="skel-item" aria-hidden="true">
        <div skeleton="text" style="width: 20%" />
        <div skeleton="text" style="width: 70%; height: 1.1em" />
        <div skeleton style="height: 40px" />
        <div skeleton style="height: 40px" />
      </div>
    </div>

    <template v-else-if="data">
      <header class="head">
        <div class="title-row">
          <h1>{{ data.response.name }}</h1>
          <span v-if="data.response.section" class="section">{{
            data.response.section
          }}</span>
          <span class="score" :data-low="low || undefined"
            >{{ data.response.score }} / {{ data.response.total }}</span
          >
          <button
            type="button"
            class="delete"
            aria-label="Delete response"
            title="Delete response"
            :disabled="remove.pending.value"
            @click="remove.run()"
          >
            <Icon name="delete" :size="20" />
          </button>
        </div>
        <p v-if="remove.error.value" class="error" role="alert">
          {{ remove.error.value.message }}
        </p>
        <p class="sub">
          {{
            data.response.status === "finished"
              ? `Finished ${edited(data.response.finishedAt!)}`
              : "Still answering"
          }}
          · {{ data.items.filter((i) => i.answer).length }} of
          {{ data.items.length }} answered
        </p>
        <p v-if="data.response.shuffled || pending" class="notes">
          <span v-if="data.response.shuffled"
            ><Icon name="shuffle" :size="16" /> Shuffled for this
            respondent.</span
          >
          <span v-if="pending" class="waiting"
            ><Icon name="edit" :size="16" /> {{ pending }}
            {{ pending === 1 ? "essay waits" : "essays wait" }} for your
            score.</span
          >
        </p>
      </header>

      <ol class="items">
        <li
          v-for="(it, n) in data.items"
          :key="it.question.id"
          class="item"
          :data-correct="
            it.answer && !it.answer.pending ? it.answer.correct : undefined
          "
          :data-pending="it.answer?.pending || undefined"
        >
          <div class="qhead">
            <span class="num">{{ n + 1 }}</span>
            <span class="kind">{{ KIND_LABEL[it.question.kind] }}</span>
            <span v-if="data.response.shuffled && it.key" class="key"
              >Key {{ it.key }}</span
            >
            <span class="pts waiting" v-if="it.answer?.pending"
              >Waiting for your score</span
            >
            <span class="pts" v-else-if="it.answer"
              >{{ it.answer.score }} / {{ it.question.points }}</span
            >
            <span class="pts skipped" v-else>Not answered</span>
          </div>
          <p class="prompt">{{ it.question.prompt }}</p>

          <!-- Choices: the right one green, a wrong pick red, as in the design. -->
          <ul
            v-if="
              it.question.kind === 'choice' || it.question.kind === 'truefalse'
            "
            class="options"
          >
            <li
              v-for="({ i, c }, at) in shown(it)"
              :key="i"
              :data-state="
                i === it.question.answer
                  ? 'right'
                  : it.answer && it.answer.choice === i
                    ? 'wrong'
                    : undefined
              "
            >
              <b>{{ LETTERS[at] }}.</b>
              <span class="opt">
                <span
                  >{{ c.text }}
                  <em v-if="i === it.question.answer">(correct answer)</em>
                  <em v-else-if="it.answer && it.answer.choice === i"
                    >(their answer)</em
                  ></span
                >
                <small v-if="c.why">{{ c.why }}</small>
              </span>
            </li>
          </ul>

          <!-- Typed answers: what they wrote, the verdict, and who gave it. -->
          <div v-else class="typed">
            <p class="given">{{ it.answer?.text || "(no answer)" }}</p>
            <p v-if="it.question.kind === 'identify'" class="accepted">
              Accepted: {{ it.question.accepted.join(", ") }}
            </p>
            <p
              v-if="it.question.kind === 'essay' && it.question.rubric"
              class="accepted"
            >
              Rubric ({{ it.question.points }} points):
              {{ it.question.rubric }}
            </p>
            <p v-if="it.answer?.verdict" class="verdict">
              <span v-if="it.answer.byAi && !it.answer.overridden" class="ai"
                >AI</span
              >
              {{ it.answer.verdict }}
            </p>
            <p v-if="it.answer?.overridden" class="changed">
              You changed this score.
            </p>
            <div v-if="it.answer" class="override">
              <template v-if="editing === it.answer.id">
                <label>
                  Score
                  <input
                    v-model.number="draft"
                    type="number"
                    inputmode="decimal"
                    @keydown.enter.prevent="saveScore(it.answer)"
                    min="0"
                    :max="it.question.points"
                    step="0.5"
                  />
                  of {{ it.question.points }}
                </label>
                <button
                  btn="primary"
                  class="small"
                  @click="saveScore(it.answer)"
                >
                  Save score
                </button>
                <button btn="quiet" class="small" @click="editing = null">
                  Cancel
                </button>
                <p v-if="saveError" class="error" role="alert">
                  {{ saveError }}
                </p>
              </template>
              <button
                v-else-if="it.answer.pending"
                btn="primary"
                class="small"
                @click="startEdit(it.answer)"
              >
                Give a score
              </button>
              <button v-else btn class="small" @click="startEdit(it.answer)">
                Change score
              </button>
            </div>
          </div>
        </li>
      </ol>
    </template>
    <ConfirmDialog ref="confirm" />
  </div>
</template>

<style scoped>
.response {
  width: min(100%, var(--page-w));
  padding: 28px var(--page-pad) 64px;
}

.state {
  padding: 64px 0;
  text-align: center;
  color: var(--muted);
}
/* While the response loads: the name, then three cards' worth of lines. */
.skel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.skel-head {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px 0 12px;
}
.skel-item {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--surface);
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
}
.title-row {
  display: flex;
  align-items: baseline;
  gap: 14px;
  margin-top: 8px;

  h1 {
    margin: 0;
    font-size: clamp(24px, 3vw, 30px);
  }
}
/* The section, beside the name in the muted weight the sub line uses. */
.section {
  font-size: 15px;
  color: var(--muted);
}
.score {
  font: 650 22px var(--font-heading);
  color: var(--good);

  &[data-low] {
    color: var(--bad);
  }
}
.delete {
  display: grid;
  flex: none;
  place-items: center;
  align-self: center;
  width: 44px;
  height: 44px;
  margin-left: auto;
  padding: 0;
  border: 0;
  border-radius: var(--radius-md);
  background: none;
  color: var(--muted);
  cursor: pointer;
  transition:
    background var(--fast) var(--ease),
    color var(--fast) var(--ease);

  &:hover:not(:disabled) {
    background: color-mix(in srgb, var(--bad) 12%, var(--surface));
    color: var(--bad);
  }
  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
}
.head .error {
  margin: 6px 0 0;
}
.sub {
  margin: 6px 0 0;
  font-size: 14px;
  color: var(--muted);
}

.items {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 20px 0 0;
  padding: 0;
  list-style: none;
}
.notes {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  margin: 6px 0 0;
  font-size: 14px;
  color: var(--muted);

  span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .waiting {
    color: color-mix(in srgb, var(--warn) 80%, black);
    font-weight: 600;
  }
}
.item {
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-left: 4px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--surface);

  &[data-correct="true"] {
    border-left-color: var(--good);
  }
  &[data-correct="false"] {
    border-left-color: var(--bad);
  }
  &[data-pending] {
    border-left-color: var(--warn);
  }
}
.key {
  padding: 1px 8px;
  border-radius: var(--radius-full);
  background: var(--sunken);
  font-weight: 600;
}
.qhead {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.num {
  min-width: 24px;
  padding: 1px 6px;
  border-radius: var(--radius-tile);
  background: var(--accent);
  color: var(--accent-ink);
  font-weight: 650;
  text-align: center;
}
.kind {
  color: var(--muted);
}
.pts {
  margin-left: auto;
  font-weight: 600;

  &.skipped {
    font-weight: 400;
    color: var(--muted);
  }
  &.waiting {
    color: color-mix(in srgb, var(--warn) 80%, black);
  }
}
.prompt {
  margin: 8px 0 10px;
  font-weight: 600;
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
    gap: 10px;
    padding: 8px 12px;
    border-radius: var(--radius-lg);
    background: var(--sunken);
    font-size: 14px;

    &[data-state="right"] {
      background: var(--good-soft);
    }
    &[data-state="wrong"] {
      background: var(--bad-soft);
    }
  }
  /* The answer and its label share a line; the reason goes under them. */
  .opt {
    display: flex;
    flex-direction: column;
  }
  em {
    font-style: normal;
    font-weight: 600;
  }
  li[data-state="right"] em {
    color: color-mix(in srgb, var(--good) 75%, black);
  }
  li[data-state="wrong"] em {
    color: var(--bad);
  }
  small {
    margin-top: 2px;
    font-size: 13px;
    color: var(--muted);
  }
}
.typed {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;

  p {
    margin: 0;
  }
}
.given {
  padding: 10px 12px;
  border-radius: var(--radius-lg);
  background: var(--sunken);
  white-space: pre-wrap;
}
.accepted,
.changed {
  font-size: 13px;
  color: var(--muted);
}
.verdict {
  font-size: 14px;
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
}
.override {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 4px;

  label {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  input {
    width: 72px;
    height: 44px;
    padding: 0 6px;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    font: inherit;
  }
}
.small {
  min-height: 44px;
  padding: 0 12px;
  font-size: 13px;
}
.error {
  width: 100%;
  font-size: 13px;
  color: var(--bad);
}
</style>
