<script setup lang="ts">
import { computed, ref } from "vue"
import { renderSVG } from "uqr"
import Icon from "./Icon.vue"
import { api } from "../composables/api"
import { useAction } from "../composables/fetch"
import { refreshQuizzes } from "../composables/quizzes"

/**
 * A quiz's sharing: while it is shared, the link, a copy button and its QR
 * code; while it is a draft, the way to share it. On the overview's panel,
 * and larger on the quiz's Sharing page, with the QR code to download.
 */
const props = withDefaults(
  defineProps<{
    quizId: number
    status: "draft" | "published"
    shareCode: string
    questions: number
    large?: boolean
  }>(),
  { large: false },
)
const emit = defineEmits<{ changed: [] }>()

const link = computed(() => `${location.origin}/q/${props.shareCode}`)
const qr = computed(() =>
  renderSVG(link.value, {
    border: 1,
    whiteColor: "#ffffff",
    blackColor: "#1a1a1a",
  }),
)
const qrFile = computed(
  () => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.value)}`,
)

const copied = ref(false)
async function copy() {
  await navigator.clipboard.writeText(link.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 1600)
}

const setStatus = useAction(async (status: "draft" | "published") => {
  await api(`/quizzes/${props.quizId}`, { method: "PATCH", body: { status } })
  refreshQuizzes()
  emit("changed")
})
</script>

<template>
  <div class="share-card" :data-large="large || undefined">
    <template v-if="status === 'published'">
      <p class="muted">
        Anyone with the link can answer. They give a name and need no account.
      </p>
      <div class="link">
        <input
          :value="link"
          readonly
          aria-label="Link to the quiz"
          @focus="($event.target as HTMLInputElement).select()"
        />
        <button btn class="small" @click="copy">
          {{ copied ? "Copied" : "Copy" }}
        </button>
      </div>
      <div
        class="qr"
        v-html="qr"
        role="img"
        aria-label="QR code for the link"
      />
      <div v-if="large" class="row">
        <a
          :href="qrFile"
          :download="`quiz-${shareCode}-qr.svg`"
          btn
          class="small"
        >
          <Icon name="download" :size="18" /> Download the QR code
        </a>
        <a :href="link" target="_blank" rel="noopener" btn class="small">
          <Icon name="open" :size="18" /> Open the quiz
        </a>
      </div>
      <button
        btn="quiet"
        class="small stop"
        :disabled="setStatus.pending.value"
        @click="setStatus.run('draft')"
      >
        Stop sharing
      </button>
    </template>
    <template v-else>
      <p class="muted">
        The quiz is a draft. Sharing makes a link and a QR code anyone can
        answer from.
      </p>
      <button
        btn="primary"
        :disabled="setStatus.pending.value || !questions"
        @click="setStatus.run('published')"
      >
        Share the quiz
      </button>
      <p v-if="!questions" class="muted">Add a question to the quiz first.</p>
    </template>
    <p v-if="setStatus.error.value" class="error" role="alert">
      {{ setStatus.error.value.message }}
    </p>
  </div>
</template>

<style scoped>
.share-card {
  display: flex;
  flex-direction: column;
  gap: 10px;

  p {
    margin: 0;
  }
}
.muted {
  font-size: 13px;
  color: var(--muted);
}
.error {
  font-size: 13px;
  color: var(--bad);
}
.small {
  min-height: 44px;
  padding: 0 12px;
  font-size: 13px;
}
.link {
  display: flex;
  gap: 8px;

  input {
    flex: 1;
    min-width: 0;
    height: 44px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--sunken);
    font: inherit;
    font-size: 13px;
    color: var(--ink);
  }
}
.qr {
  align-self: center;
  width: 150px;
  padding: 6px;
  border-radius: var(--radius-lg);
  background: white;

  :deep(svg) {
    display: block;
    width: 100%;
    height: auto;
  }
}
.row {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}
.stop {
  align-self: center;
}

[data-large] {
  gap: 14px;

  .muted {
    font-size: 14px;
  }
  .qr {
    width: 240px;
    padding: 10px;
  }
}
</style>
