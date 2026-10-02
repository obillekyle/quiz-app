<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import ConfirmDialog from "../components/ConfirmDialog.vue"
import Icon from "../components/Icon.vue"
import PromptBox from "../components/PromptBox.vue"
import QuizCard from "../components/QuizCard.vue"
import { useActivity } from "../composables/activity"
import { api } from "../composables/api"
import { useAuth } from "../composables/auth"
import { useCookie } from "../composables/cookie"
import { useAction, useFetch } from "../composables/fetch"
import { refreshQuizzes, useQuizzes } from "../composables/quizzes"
import { toast } from "../composables/toast"

const route = useRoute()
const { userdata } = useAuth()
const { quizzes, loading, error, refresh } = useQuizzes()
const activity = useActivity()
onMounted(() => {
  if (activity.data.value) activity.refresh()
})

const greeting = computed(() => {
  const h = new Date().getHours()
  const part =
    h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"
  const first = userdata.value?.name.trim().split(/\s+/)[0]
  return first ? `${part}, ${first}.` : `${part}.`
})

// ---- the prompt box: sending starts a quiz and opens the builder -----------
const router = useRouter()
const box = ref<InstanceType<typeof PromptBox>>()

watch(
  () => route.query.new,
  async (n) => {
    if (n !== "1") return
    await nextTick()
    box.value?.focus()
    const { new: _new, ...rest } = route.query
    router.replace({ query: rest })
  },
  { immediate: true },
)
const creating = ref(false)
const note = ref("")

async function create(text: string, sources: number[]) {
  creating.value = true
  note.value = ""
  try {
    const { id } = await api<{ id: number }>("/quizzes", {
      body: { prompt: text, sources },
    })
    box.value?.clear()
    refreshQuizzes()
    // ?ai=1: a quiz from the prompt box opens with the AI panel (the onboarding).
    await router.push(`/app/quiz/${id}/edit?ai=1`)
  } catch (e) {
    note.value = e instanceof Error ? e.message : String(e)
  } finally {
    creating.value = false
  }
}

// ---- the list -----------------------------------------------------------------
const viewCookie = useCookie("qa_view")
const view = computed({
  get: () => (viewCookie.value === "list" ? "list" : "grid"),
  set: (v) => (viewCookie.value = v === "list" ? "list" : null),
})
const sortCookie = useCookie("qa_sort")
const sort = computed({
  get: () => sortCookie.value ?? "edited",
  set: (v: string) => (sortCookie.value = v === "edited" ? null : v),
})

const shown = computed(() => {
  const q = (typeof route.query.q === "string" ? route.query.q : "")
    .trim()
    .toLowerCase()
  const live = quizzes.value.filter(
    (x) => !x.archived && (!current.value || x.bin === current.value.id),
  )
  const list = q ? live.filter((x) => x.title.toLowerCase().includes(q)) : live
  if (sort.value === "name") list.sort((a, b) => a.title.localeCompare(b.title))
  else if (sort.value === "created")
    list.sort((a, b) => b.createdAt - a.createdAt)
  else list.sort((a, b) => b.updatedAt - a.updatedAt)
  return list
})
const searching = computed(
  () => typeof route.query.q === "string" && route.query.q.trim() !== "",
)

// ---- the bins: folders the list is filtered by --------------------------------
type Bin = { id: number; name: string; count: number }
const binList = useFetch<Bin[]>("/bins")
const bins = computed(() => binList.data.value ?? [])
const chosen = ref<number | null>(null)
/** The chosen bin. Read through the list, so a bin deleted elsewhere falls back to All. */
const current = computed(
  () => bins.value.find((b) => b.id === chosen.value) ?? null,
)
/** The chosen bin holds no quiz at all, whatever the search says. */
const emptyBin = computed(
  () =>
    !!current.value &&
    !quizzes.value.some((x) => !x.archived && x.bin === current.value!.id),
)

/** The inline field: a new bin's name, or the chosen bin's while it is renamed. */
const editing = ref<"new" | "rename" | null>(null)
const draft = ref("")
const binNote = ref("")
/** The field takes the cursor as it appears, with a renamed bin's name selected. */
const vFocus = {
  mounted(el: HTMLInputElement) {
    el.focus()
    el.select()
  },
}

function edit(what: "new" | "rename") {
  editing.value = what
  draft.value = what === "rename" ? (current.value?.name ?? "") : ""
  binNote.value = ""
}
function cancel() {
  editing.value = null
  binNote.value = ""
}
function choose(id: number | null) {
  cancel()
  chosen.value = id
}

const saveBin = useAction(async () => {
  const name = draft.value.trim()
  if (!name) {
    binNote.value = "Give the bin a name."
    return
  }
  const renaming = editing.value === "rename" && current.value
  if (renaming && name === renaming.name) return cancel()
  try {
    const bin = await api<Bin>(renaming ? `/bins/${renaming.id}` : "/bins", {
      method: renaming ? "PATCH" : "POST",
      body: { name },
    })
    await binList.refresh()
    // A new bin opens at once: its empty state says how a quiz gets into it.
    chosen.value = bin.id
    cancel()
  } catch (e) {
    binNote.value = e instanceof Error ? e.message : String(e)
  }
})

const confirm = ref<InstanceType<typeof ConfirmDialog>>()
const removeBin = useAction(async () => {
  const bin = current.value
  if (!bin) return
  const ok = await confirm.value?.ask({
    title: `Delete “${bin.name}”?`,
    text: "Its quizzes are kept and go back to no bin.",
    action: "Delete bin",
    danger: true,
  })
  if (!ok) return
  try {
    await api(`/bins/${bin.id}`, { method: "DELETE" })
    chosen.value = null
    binNote.value = ""
    // The quizzes that were in it now carry no bin.
    refreshQuizzes()
    await binList.refresh()
    toast("Bin deleted. Its quizzes are kept.")
  } catch (e) {
    binNote.value = e instanceof Error ? e.message : String(e)
  }
})
</script>

<template>
  <div class="home">
    <h1>{{ greeting }}</h1>

    <PromptBox
      ref="box"
      :busy="creating"
      :hint="
        creating
          ? 'Starting your quiz…'
          : 'Attach a module or photos of a handout, or describe the quiz.'
      "
      @send="create"
    />
    <p v-if="note" class="note" role="alert">{{ note }}</p>

    <div class="toolbar">
      <div flex items="center" gap="md">
        <h2>Your quizzes</h2>
        <select v-model="sort" aria-label="Sort quizzes">
          <option value="edited">Last edited</option>
          <option value="created">Newest</option>
          <option value="name">Name</option>
        </select>
      </div>
      <div class="views" role="group" aria-label="View">
        <button
          :aria-pressed="view === 'grid'"
          aria-label="Grid"
          title="Grid"
          @click="view = 'grid'"
        >
          <Icon name="grid" :size="18" />
        </button>
        <button
          :aria-pressed="view === 'list'"
          aria-label="List"
          title="List"
          @click="view = 'list'"
        >
          <Icon name="list" :size="18" />
        </button>
      </div>
    </div>

    <div v-if="quizzes.length || bins.length" class="bins">
      <div class="chips" role="group" aria-label="Bins">
        <button
          type="button"
          class="chip"
          :aria-pressed="!current"
          @click="choose(null)"
        >
          <Icon v-if="!current" name="check" :size="18" />
          All
        </button>
        <template v-for="b in bins" :key="b.id">
          <form
            v-if="editing === 'rename' && current?.id === b.id"
            class="chip-form"
            @submit.prevent="saveBin.run()"
          >
            <input
              v-model="draft"
              v-focus
              field
              maxlength="80"
              autocomplete="off"
              enterkeyhint="done"
              aria-label="Bin name"
              :aria-invalid="!!binNote || undefined"
              @keydown.esc="cancel"
            />
          </form>
          <button
            v-else
            type="button"
            class="chip"
            :aria-pressed="current?.id === b.id"
            :aria-label="`${b.name}, ${b.count} ${b.count === 1 ? 'quiz' : 'quizzes'}`"
            @click="choose(b.id)"
          >
            <Icon v-if="current?.id === b.id" name="check" :size="18" />
            <span class="name">{{ b.name }}</span>
            <span class="n">{{ b.count }}</span>
          </button>
        </template>
        <form
          v-if="editing === 'new'"
          class="chip-form"
          @submit.prevent="saveBin.run()"
        >
          <input
            v-model="draft"
            v-focus
            field
            maxlength="80"
            autocomplete="off"
            enterkeyhint="done"
            placeholder="Bin name"
            aria-label="Bin name"
            :aria-invalid="!!binNote || undefined"
            @keydown.esc="cancel"
          />
        </form>
        <button v-else type="button" class="chip new" @click="edit('new')">
          <Icon name="plus" :size="18" />
          New bin
        </button>
        <span v-if="current && editing !== 'rename'" class="bin-actions">
          <button btn="quiet" type="button" @click="edit('rename')">
            Rename bin
          </button>
          <button
            btn="quiet"
            type="button"
            class="delete"
            :disabled="removeBin.pending.value"
            @click="removeBin.run()"
          >
            Delete bin
          </button>
        </span>
      </div>
      <p v-if="binNote" class="note" role="alert">{{ binNote }}</p>
    </div>

    <p v-if="error" class="state" role="alert">
      {{ error.message }}
      <button class="link" @click="refresh()">Try again</button>
    </p>
    <div
      v-else-if="loading && !quizzes.length"
      class="cards"
      :data-view="view"
      aria-label="Loading your quizzes"
    >
      <div v-for="n in 4" :key="n" class="card-skel" aria-hidden="true">
        <div skeleton class="cover" />
        <div skeleton="text" style="width: 70%" />
        <div skeleton="text" style="width: 45%" />
      </div>
    </div>
    <p v-else-if="emptyBin" class="state">
      This bin is empty. Move a quiz here from its settings.
    </p>
    <p v-else-if="!shown.length && searching" class="state">
      No quiz matches “{{ route.query.q }}”.
    </p>
    <p v-else-if="!shown.length" class="state">
      No quizzes yet. Describe one above, or attach a module to start.
    </p>

    <div class="cards" v-else :data-view="view">
      <QuizCard v-for="q in shown" :key="q.id" :quiz="q" :layout="view" />
    </div>
    <ConfirmDialog ref="confirm" />
  </div>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  width: min(100%, var(--page-w));
  padding: 28px var(--page-pad) 64px;
}

h1 {
  margin: 0 0 16px;
  font-size: 26px;
  font-weight: 650;
  letter-spacing: -0.02em;
}

.note {
  margin: 8px 4px 0;
  font-size: 14px;
  color: var(--muted);
}

/* ---- the list ------------------------------------------------------------- */

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 40px 0 16px;

  h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 650;
  }

  select {
    height: 32px;
    padding: 0 30px 0 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background-color: var(--surface);
    font: inherit;
    font-size: 14px;
    color: color-mix(in srgb, var(--ink) 75%, transparent);
    cursor: pointer;
  }
}

.views {
  display: flex;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--surface);

  button {
    display: grid;
    place-items: center;
    width: 34px;
    height: 30px;
    border: 0;
    border-radius: var(--radius-tile);
    background: none;
    color: var(--muted);
    cursor: pointer;

    &[aria-pressed="true"] {
      background: var(--sunken);
      color: var(--ink);
    }
  }
}

/* ---- the bins: Material filter chips in one row, the chosen one filled ---- */
.bins {
  margin-bottom: 16px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.chip {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 14px;
  border: 1px solid color-mix(in srgb, var(--ink) 22%, transparent);
  border-radius: var(--radius-md);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: background var(--fast) var(--ease);

  &:hover {
    background: var(--hover);
  }
  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  &[aria-pressed="true"] {
    border-color: transparent;
    background: color-mix(in srgb, var(--accent) 16%, var(--surface));
  }
  /* A long name ends in an ellipsis, so one bin never takes the row. */
  .name {
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .n {
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    color: color-mix(in srgb, var(--ink) 70%, transparent);
  }
  /* The chip that makes a bin is an action, not a filter: no fill behind it. */
  &.new {
    padding-left: 10px;
    background: none;

    &:hover {
      background: var(--hover);
    }
  }
}
/* The inline field stands where its chip stood, at the chip's height. */
.chip-form {
  flex: none;

  input {
    width: 200px;
    height: 40px;
    min-height: 40px;
    font-size: 14px;
  }
}
.bin-actions {
  display: flex;
  flex: none;
  gap: 4px;
  margin-left: auto;

  [btn] {
    min-height: 40px;
    padding: 0 12px;
    font-size: 14px;
  }
  .delete {
    color: var(--bad);
  }
}

.state {
  padding: 48px 16px;
  text-align: center;
  color: var(--muted);
}

.link {
  border: 0;
  background: none;
  font: inherit;
  font-weight: 600;
  color: var(--accent);
  cursor: pointer;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
}

/* The loading state, in the cards' own shape. */
.card-skel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-bottom: 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  background: var(--surface);
  overflow: hidden;

  .cover {
    height: 130px;
    margin-bottom: 4px;
    border-radius: 0;
  }
  [skeleton="text"] {
    margin-inline: 14px;
  }
}
.cards[data-view="list"] .card-skel {
  flex-direction: row;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  border: 0;
  border-radius: 0;

  .cover {
    width: 40px;
    height: 40px;
    margin: 0;
    border-radius: var(--radius-md);
  }
  [skeleton="text"] {
    margin: 0;
  }
}

.cards[data-view="list"] {
  grid-template-columns: 1fr;
  gap: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  overflow: hidden;
  background: var(--surface);

  > * + * {
    border-top: 1px solid var(--line);
  }
}

@media (max-width: 767px) {
  .home {
    padding-top: 20px;
  }
  /* A finger's height for the sort and both halves of the view toggle. */
  .toolbar select {
    height: 44px;
  }
  .views button {
    width: 44px;
    height: 44px;
  }
  .chips {
    flex-wrap: nowrap;
    margin: -4px calc(-1 * var(--page-pad));
    padding: 4px var(--page-pad);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .chip,
  .chip-form input,
  .bin-actions [btn] {
    height: 44px;
    min-height: 44px;
  }
  /* 16px: a smaller field makes iOS zoom the page when it takes focus. */
  .chip-form input {
    font-size: 16px;
  }
  .bin-actions {
    margin-left: 0;
  }
}
</style>
