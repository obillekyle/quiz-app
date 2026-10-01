<script setup lang="ts">
import { computed, ref } from "vue"
import { useRouter } from "vue-router"
import ConfirmDialog from "./ConfirmDialog.vue"
import Icon from "./Icon.vue"
import { api } from "../composables/api"
import { useAction } from "../composables/fetch"
import { refreshQuizzes } from "../composables/quizzes"

/**
 * What can be done to a quiz, as a short list at the top of its overview's
 * panel (Kyle, 23:10): Edit quiz first and in the accent, then print,
 * duplicate, archive, and delete in red.
 */
const props = defineProps<{
  quizId: number
  title: string
  archived: boolean
  questions: number
}>()
const emit = defineEmits<{ changed: [] }>()
const router = useRouter()

const confirm = ref<InstanceType<typeof ConfirmDialog>>()
const duplicate = useAction(async () => {
  const r = await api<{ id: number }>(`/quizzes/${props.quizId}/duplicate`, {
    method: "POST",
  })
  refreshQuizzes()
  await router.push(`/app/quiz/${r.id}`)
})
const archive = useAction(async (to: boolean) => {
  await api(`/quizzes/${props.quizId}`, {
    method: "PATCH",
    body: { archived: to },
  })
  refreshQuizzes()
  emit("changed")
})
const remove = useAction(async () => {
  const ok = await confirm.value?.ask({
    title: `Delete “${props.title}”?`,
    text: "Its questions, files and every response go with it. This cannot be undone.",
    action: "Delete quiz",
    danger: true,
  })
  if (!ok) return
  await api(`/quizzes/${props.quizId}`, { method: "DELETE" })
  refreshQuizzes()
  await router.replace("/app")
})
const failure = computed(
  () =>
    duplicate.error.value?.message ??
    archive.error.value?.message ??
    remove.error.value?.message,
)
</script>

<template>
  <div class="actions">
    <RouterLink :to="`/app/quiz/${quizId}/edit`" class="option primary">
      <Icon name="edit" :size="20" /> Edit quiz
      <Icon name="forward" :size="20" class="go" />
    </RouterLink>
    <RouterLink
      v-if="questions"
      :to="`/app/quiz/${quizId}/print`"
      class="option"
    >
      <Icon name="print" :size="18" /> Print as a test
    </RouterLink>
    <button
      type="button"
      class="option"
      :disabled="duplicate.pending.value"
      @click="duplicate.run()"
    >
      <Icon name="copy" :size="18" />
      {{ duplicate.pending.value ? "Duplicating…" : "Duplicate" }}
    </button>
    <button
      type="button"
      class="option"
      :disabled="archive.pending.value"
      @click="archive.run(!archived)"
    >
      <Icon :name="archived ? 'unarchive' : 'archive'" :size="18" />
      {{ archived ? "Restore from the archive" : "Archive" }}
    </button>
    <button
      type="button"
      class="option danger"
      :disabled="remove.pending.value"
      @click="remove.run()"
    >
      <Icon name="delete" :size="18" /> Delete quiz
    </button>
    <p v-if="failure" class="error" role="alert">{{ failure }}</p>
    <ConfirmDialog ref="confirm" />
  </div>
</template>

<style scoped>
.actions {
  display: flex;
  flex-direction: column;
}
.option {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  margin: 0 -8px;
  padding: 0 8px;
  border: 0;
  border-radius: 8px;
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
  &:focus-visible {
    outline: 2px solid var(--accent);
  }
  &.danger {
    color: var(--bad);
  }
}
/* Edit quiz: the one action the panel exists for, in the accent. */
.primary {
  min-height: 48px;
  margin: 0 0 6px;
  padding: 0 14px;
  background: var(--accent);
  color: var(--accent-ink);
  font-size: 15px;
  font-weight: 700;

  &:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 88%, black);
  }
  .go {
    margin-left: auto;
  }
}
.error {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--bad);
}
</style>
