<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import Icon from "../components/Icon.vue"
import PromptBox from "../components/PromptBox.vue"
import QuizCard from "../components/QuizCard.vue"
import { useActivity } from "../composables/activity"
import { api } from "../composables/api"
import { useAuth } from "../composables/auth"
import { useCookie } from "../composables/cookie"
import { refreshQuizzes, useQuizzes } from "../composables/quizzes"

const route = useRoute()
const { userdata } = useAuth()
const { quizzes, loading, error, refresh } = useQuizzes()
// The cards' response lines: read again on every visit after the first, so a
// class that answered while another page was open shows up.
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

// The sidebar's New quiz lands here with ?new=1: the cursor goes to the prompt
// box, and the address loses the flag so a refresh does not repeat it.
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
  const live = quizzes.value.filter((x) => !x.archived)
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
    <p v-else-if="!shown.length && searching" class="state">
      No quiz matches “{{ route.query.q }}”.
    </p>
    <p v-else-if="!shown.length" class="state">
      No quizzes yet. Describe one above, or attach a module to start.
    </p>

    <div class="cards" v-else :data-view="view">
      <QuizCard v-for="q in shown" :key="q.id" :quiz="q" :layout="view" />
    </div>
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
}
</style>
