<script setup lang="ts">
import { computed } from "vue"
import { useRoute } from "vue-router"
import QuizHead from "../components/QuizHead.vue"
import ShareCard from "../components/ShareCard.vue"
import { useFetch } from "../composables/fetch"
import type { FullQuiz } from "../composables/quizzes"

/** A quiz's Sharing page: the link and the QR code at full size, to download or show a class. */
const route = useRoute()
const id = computed(() => Number(route.params.id))
const { data, error, loading, refresh } = useFetch<FullQuiz>(
  () => `/quizzes/${id.value}`,
)
</script>

<template>
  <div class="page">
    <p v-if="error" class="state" role="alert">{{ error.message }}</p>
    <div v-else-if="loading && !data" aria-label="Loading the quiz">
      <QuizHead :quiz-id="id" quiz="" page="Sharing" />
      <section class="panel skel" aria-hidden="true">
        <div skeleton="text" style="width: 45%" />
        <div class="skel-link">
          <div skeleton style="flex: 1; height: 44px" />
          <div skeleton style="width: 60px; height: 44px" />
        </div>
        <div
          skeleton
          style="
            width: 204px;
            height: 204px;
            margin: 12px auto 0;
            border-radius: var(--radius-lg);
          "
        />
        <div class="skel-row">
          <div skeleton style="width: 196px; height: 44px" />
          <div skeleton style="width: 140px; height: 44px" />
        </div>
        <div skeleton="text" style="width: 80px; margin: 12px auto 20px" />
      </section>
      <p class="aside">
        People who answer appear in Respondents as they finish. Stopping sharing
        turns the link off; sharing again brings back the same link.
      </p>
    </div>
    <template v-else-if="data">
      <QuizHead
        :quiz-id="id"
        :quiz="data.quiz.title"
        page="Sharing"
        :status="data.quiz.status"
        :archived="data.quiz.archived"
      />
      <p v-if="data.quiz.archived" class="note" role="note">
        The quiz is archived, so its link does not open. Restore it in Settings
        to share it again.
      </p>
      <section class="panel">
        <ShareCard
          :quiz-id="id"
          :status="data.quiz.status"
          :share-code="data.quiz.shareCode"
          :questions="data.questions.length"
          large
          @changed="refresh"
        />
      </section>
      <p class="aside">
        People who answer appear in Respondents as they finish. Stopping sharing
        turns the link off; sharing again brings back the same link.
      </p>
    </template>
  </div>
</template>

<style scoped>
.page {
  width: min(100%, 1120px);
  padding: 28px var(--page-pad) 64px;
}

/* While the quiz loads: the panel's rows, in their places. */
.skel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.skel-link {
  display: flex;
  gap: 8px;
}
.skel-row {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 25px;
}
.state {
  padding: 64px 0;
  text-align: center;
  color: var(--muted);
}
.panel {
  padding: 24px;
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  background: var(--surface);
}
.note {
  margin: 0 0 12px;
  padding: 10px 14px;
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--warn) 12%, var(--surface));
  color: color-mix(in srgb, var(--warn) 75%, black);
  font-size: 14px;
}
.aside {
  margin: 12px 0 0;
  font-size: 13px;
  color: var(--muted);
}
</style>
