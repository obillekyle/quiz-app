<script setup lang="ts">
import { computed } from "vue"
import Icon from "./Icon.vue"
import QuizThumb from "./QuizThumb.vue"
import Sparkline from "./Sparkline.vue"
import { useActivity } from "../composables/activity"
import { edited, type QuizSummary } from "../composables/quizzes"

/**
 * A quiz on the home page: a card in the grid, a row in the list. The
 * thumbnail is its cover, else its icon, else its first letter on its color. A globe marks a
 * quiz anyone with the link can answer, and the square beside it is the
 * last 14 days of finished responses, one request for every card.
 */
const props = defineProps<{ quiz: QuizSummary; layout: "grid" | "list" }>()
const activity = useActivity()
const counts = computed(() => activity.of(props.quiz.id))
const shared = computed(
  () => props.quiz.status === "published" && !props.quiz.archived,
)
const SHARED = "Shared. Anyone with the link can answer."
</script>

<template>
  <RouterLink :to="`/app/quiz/${quiz.id}`" class="card" :data-layout="layout">
    <QuizThumb
      class="thumb"
      :id="quiz.id"
      :icon="quiz.icon"
      :image="quiz.image"
      :title="quiz.title"
      :icon-size="layout === 'grid' ? 64 : 26"
    />
    <div class="meta">
      <strong>{{ quiz.title }}</strong>
      <span class="line">
        <span class="text"
          >{{ quiz.questions }}
          {{ quiz.questions === 1 ? "question" : "questions" }} · Edited
          {{ edited(quiz.updatedAt) }}</span
        >
        <em v-if="quiz.language === 'fil'">Filipino</em>
      </span>
    </div>
    <!-- The globe's spot is kept when it is empty, so the lines align down the list. -->
    <div class="signals">
      <span class="globe">
        <span
          v-if="shared"
          role="img"
          :aria-label="SHARED"
          :title="SHARED"
          class="globe-mark"
          ><Icon name="globe" :size="20"
        /></span>
      </span>
      <Sparkline v-if="counts" :counts="counts" />
    </div>
  </RouterLink>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  background: var(--surface);
  color: var(--ink);
  text-decoration: none;
  transition:
    transform var(--fast) var(--ease),
    box-shadow var(--fast) var(--ease);

  &:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }
  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
}

.thumb {
  height: 132px;
}

.meta {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 12px 14px 4px;

  strong {
    font-weight: 600;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  span {
    font-size: 13px;
    color: var(--muted);
  }
  /* The words stay on one line; the language chip wraps under them first. */
  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    min-width: 0;
  }
  .text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  em {
    flex: none;
    padding: 1px 8px;
    border-radius: var(--radius-full);
    background: var(--sunken);
    font-style: normal;
    font-size: 12px;
  }
}

/* The grid card's footer: the globe at the left, the sparkline at the right. */
.signals {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 40px;
  padding: 6px 14px 14px;
}
.globe {
  display: grid;
  flex: none;
  place-items: center;
  width: 20px;
  height: 20px;
  color: var(--muted);
}
.globe-mark {
  display: grid;
}

/* The list: a row with a small swatch, the title over its meta line, and
   the globe and the sparkline at the right edge. */
.card[data-layout="list"] {
  flex-direction: row;
  align-items: center;
  padding: 10px 0;
  border: 0;
  border-radius: 0;

  &:hover {
    transform: none;
    box-shadow: none;
    background: var(--hover);
  }

  .thumb {
    flex: none;
    width: 40px;
    height: 40px;
    margin: 0 0 0 14px;
    border-radius: var(--radius-md);
  }
  .meta {
    gap: 2px;
    padding: 0 16px;

    strong {
      -webkit-line-clamp: 1;
    }
  }
  .signals {
    flex: none;
    gap: 14px;
    padding: 0 16px 0 0;
  }
}

@media (max-width: 560px) {
  /* A phone's row keeps two lines of title, so a copy's "(copy)" shows. */
  .card[data-layout="list"] .meta strong {
    -webkit-line-clamp: 2;
  }
  .card[data-layout="list"] .signals {
    gap: 10px;
    padding-right: 12px;
  }
}
</style>
