<script setup lang="ts">
import { computed, ref } from "vue"
import Icon from "../components/Icon.vue"
import QuizCard from "../components/QuizCard.vue"
import { api } from "../composables/api"
import { refreshQuizzes, useQuizzes } from "../composables/quizzes"

/**
 * The sidebar's Archived: quizzes taken off Home. An archived quiz's link
 * does not open for respondents; Restore under its card puts it back.
 */
const { quizzes, error, loading } = useQuizzes()
const archived = computed(() => quizzes.value.filter((q) => q.archived))

const restoring = ref<number | null>(null)
const failed = ref("")
async function restore(id: number) {
  if (restoring.value) return
  restoring.value = id
  failed.value = ""
  try {
    await api(`/quizzes/${id}`, { method: "PATCH", body: { archived: false } })
    refreshQuizzes()
  } catch (e) {
    failed.value = e instanceof Error ? e.message : String(e)
  } finally {
    restoring.value = null
  }
}
</script>

<template>
  <div class="page">
    <h1>Archived</h1>
    <p v-if="error" class="state" role="alert">{{ error.message }}</p>
    <div
      v-else-if="loading && !quizzes.length"
      class="grid"
      aria-label="Loading your quizzes"
    >
      <div v-for="n in 3" :key="n" class="card-skel" aria-hidden="true">
        <div skeleton style="aspect-ratio: 16 / 9" />
        <div skeleton="text" style="width: 70%" />
        <div skeleton="text" style="width: 45%" />
      </div>
    </div>
    <div v-else-if="!archived.length" class="empty">
      <Icon name="archive" :size="32" />
      <p>
        Nothing is archived. Quizzes archived from their Quiz options show here,
        out of the way.
      </p>
    </div>
    <template v-else>
      <p class="summary">
        {{ archived.length }} archived
        {{ archived.length === 1 ? "quiz" : "quizzes" }}. An archived quiz's
        link does not open for respondents.
      </p>
      <p v-if="failed" class="failed" role="alert">{{ failed }}</p>
      <div class="grid">
        <div v-for="q in archived" :key="q.id" class="item">
          <QuizCard :quiz="q" layout="grid" />
          <button
            type="button"
            btn
            :disabled="restoring === q.id"
            :aria-label="`Restore ${q.title}`"
            @click="restore(q.id)"
          >
            <Icon name="unarchive" :size="18" />
            {{ restoring === q.id ? "Restoring…" : "Restore" }}
          </button>
        </div>
      </div>
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
.summary {
  margin: 0 0 16px;
  font-size: 14px;
  color: var(--muted);
}
.failed {
  margin: 0 0 16px;
  font-size: 14px;
  color: var(--bad);
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
    max-width: 420px;
  }
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
}
.card-skel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-bottom: 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  background: var(--surface);
  overflow: hidden;

  > [skeleton]:first-child {
    border-radius: 0;
  }
  [skeleton="text"] {
    margin-inline: 14px;
  }
}
.item {
  display: flex;
  flex-direction: column;
  gap: 8px;

  button {
    align-self: flex-start;
  }
}
</style>
