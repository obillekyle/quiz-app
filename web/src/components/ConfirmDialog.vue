<script setup lang="ts">
import { ref } from "vue"

/**
 * A confirmation, as in the QuizApp design's "Delete quiz?" dialog, on the
 * browser's own <dialog>: it traps focus, Escape cancels, and the page behind
 * it is inert.
 *
 *   const confirm = ref<InstanceType<typeof ConfirmDialog>>()
 *   if (await confirm.value!.ask({ title: 'Delete "Metals"?', text: '…', action: 'Delete', danger: true })) …
 */
type Ask = { title: string; text?: string; action: string; danger?: boolean }

const dialog = ref<HTMLDialogElement>()
const current = ref<Ask>({ title: "", action: "" })
let settle: ((ok: boolean) => void) | null = null

function ask(o: Ask): Promise<boolean> {
  current.value = o
  dialog.value?.showModal()
  return new Promise((resolve) => (settle = resolve))
}

function close(ok: boolean) {
  dialog.value?.close()
  settle?.(ok)
  settle = null
}

defineExpose({ ask })
</script>

<template>
  <dialog ref="dialog" class="confirm" @cancel.prevent="close(false)">
    <h2>{{ current.title }}</h2>
    <p v-if="current.text">{{ current.text }}</p>
    <div class="actions">
      <button btn @click="close(false)">Cancel</button>
      <button
        btn="primary"
        :class="{ danger: current.danger }"
        autofocus
        @click="close(true)"
      >
        {{ current.action }}
      </button>
    </div>
  </dialog>
</template>

<style scoped>
.confirm {
  width: min(92vw, 400px);
  padding: 24px;
  border: 0;
  border-radius: var(--radius-xl);
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--shadow-md);

  &::backdrop {
    background: rgb(0 0 0 / 0.35);
  }
}

h2 {
  margin: 0;
  font-size: 19px;
}

p {
  margin: 8px 0 0;
  color: color-mix(in srgb, var(--ink) 70%, transparent);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}

.danger {
  background: var(--bad);
  border-color: var(--bad);
}
</style>
