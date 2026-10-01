<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue"
import Icon from "./Icon.vue"
import { api } from "../composables/api"

/**
 * The prompt box from Kyle's sketches, shared by the home page and the
 * builder's chat: type what you want, attach PDFs or photos (+ or drop),
 * send. Enter sends; Shift+Enter starts a new line, as in a chat box.
 *
 * A file uploads the moment it is picked and the server starts reading it
 * (its text layer, or the AI for a photo or a scan), so the material is
 * ready, or nearly, by the time the prompt is sent. Each file shows how far
 * it has got. Sending passes the files' ids; a read still running is waited
 * for by the server, not here.
 */
const props = withDefaults(
  defineProps<{
    placeholder?: string
    hint?: string
    /** While true, sending is off and the send button says why. */
    busy?: boolean
    /** A smaller box for the chat panel. */
    compact?: boolean
  }>(),
  {
    placeholder: "Create your new quiz…",
    hint: "",
    busy: false,
    compact: false,
  },
)

const emit = defineEmits<{
  send: [text: string, sources: number[], names: string[]]
}>()

const text = ref("")
const picker = ref<HTMLInputElement>()
const dragging = ref(false)
const note = ref("")

const ACCEPT = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
]

/** A file in the box, as the server reports it. */
type Upload = {
  key: number
  name: string
  photo: boolean
  state: "uploading" | "reading" | "ready" | "failed"
  id: number | null
  method: "text" | "ai" | "mixed" | null
  pages: number | null
  error: string | null
  /** Settles once the file is on the server, or failed to get there. */
  uploaded: Promise<void>
}
type View = {
  id: number
  status: "reading" | "ready" | "failed"
  method: Upload["method"]
  pages: number | null
  error: string | null
}

const uploads = ref<Upload[]>([])
let keys = 0
let gone = false
onBeforeUnmount(() => (gone = true))

function add(list: FileList | null | undefined) {
  if (!list) return
  const ok = [...list].filter(
    (f) =>
      ACCEPT.includes(f.type) || /\.(pdf|png|jpe?g|webp|heic)$/i.test(f.name),
  )
  note.value =
    ok.length < list.length ? "Only PDFs and photos can be attached." : ""
  for (const f of ok) upload(f)
}

function upload(f: File) {
  let done!: () => void
  const index = uploads.value.push({
    key: ++keys,
    name: f.name,
    photo: f.type !== "application/pdf" && !/\.pdf$/i.test(f.name),
    state: "uploading",
    id: null,
    method: null,
    pages: null,
    error: null,
    uploaded: new Promise<void>((r) => (done = r)),
  })
  // The reactive copy, so the list redraws as the server answers.
  const u = uploads.value[index - 1]!
  const apply = (v: View) =>
    Object.assign(u, {
      id: v.id,
      state: v.status,
      method: v.method,
      pages: v.pages,
      error: v.error,
    })
  ;(async () => {
    try {
      const form = new FormData()
      form.append("file", f)
      apply(await api<View>("/uploads", { body: form }))
      done()
      // Follow the reading to its end, while the file is still in the box.
      while (u.state === "reading" && !gone && uploads.value.includes(u)) {
        await new Promise((r) => setTimeout(r, 800))
        apply(await api<View>(`/uploads/${u.id}`))
      }
    } catch (e) {
      Object.assign(u, {
        state: "failed",
        error: e instanceof Error ? e.message : String(e),
      })
      done()
    }
  })()
}

function remove(u: Upload) {
  uploads.value = uploads.value.filter((x) => x !== u)
  if (u.id != null)
    api(`/uploads/${u.id}`, { method: "DELETE" }).catch(() => {})
}

/** What a file's line says about it. */
function status(u: Upload) {
  if (u.state === "uploading") return "Uploading"
  if (u.state === "reading") {
    if (u.photo) return "The AI is reading the photo, about 7 s"
    if (u.method === "ai" || u.method === "mixed")
      return "A scan: the AI is reading it, a few seconds a page"
    return "Reading"
  }
  if (u.state === "failed") return u.error ?? "Could not be read"
  const pages = u.photo ? "" : `${u.pages} ${u.pages === 1 ? "page" : "pages"}`
  if (u.photo) return "Read by the AI"
  const by =
    u.method === "ai"
      ? "read by the AI"
      : u.method === "mixed"
        ? "partly read by the AI"
        : ""
  return [pages, by].filter(Boolean).join(", ") || "Ready"
}

function onDrop(e: DragEvent) {
  dragging.value = false
  add(e.dataTransfer?.files)
}

const failed = computed(() => uploads.value.some((u) => u.state === "failed"))
const canSend = computed(
  () =>
    !props.busy &&
    !failed.value &&
    (text.value.trim() !== "" || uploads.value.length > 0),
)

const sending = ref(false)
async function send() {
  if (!canSend.value || sending.value) return
  sending.value = true
  // A file picked a moment ago may still be on its way up, and its id is needed.
  await Promise.all(uploads.value.map((u) => u.uploaded))
  sending.value = false
  if (failed.value) return
  const ready = uploads.value.filter((u) => u.id != null)
  emit(
    "send",
    text.value.trim(),
    ready.map((u) => u.id!),
    ready.map((u) => u.name),
  )
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    send()
  }
}

/** Empties the box; the parent calls it once a send went through. */
function clear() {
  text.value = ""
  uploads.value = []
  note.value = ""
}

const field = ref<HTMLTextAreaElement>()
/** Puts the cursor in the box, for the sidebar's New quiz. */
function focus() {
  field.value?.focus()
}

defineExpose({ clear, focus })
</script>

<template>
  <form
    class="box"
    :data-compact="compact || undefined"
    :data-dragging="dragging || undefined"
    @submit.prevent="send"
    @dragover.prevent="dragging = true"
    @dragleave.self="dragging = false"
    @drop.prevent="onDrop"
  >
    <textarea
      ref="field"
      v-model="text"
      :rows="compact ? 1 : 2"
      :placeholder="placeholder"
      :aria-label="placeholder"
      @keydown="onKey"
    />

    <ul v-if="uploads.length" class="files">
      <li v-for="u in uploads" :key="u.key" :data-state="u.state">
        <span
          v-if="u.state === 'uploading' || u.state === 'reading'"
          class="dots"
          aria-hidden="true"
          ><i /><i /><i
        /></span>
        <Icon v-else :name="u.photo ? 'image' : 'file'" :size="16" />
        <span class="name">{{ u.name }}</span>
        <small role="status">{{ status(u) }}</small>
        <button
          type="button"
          :aria-label="`Remove ${u.name}`"
          :title="`Remove ${u.name}`"
          @click="remove(u)"
        >
          <Icon name="close" :size="14" />
        </button>
      </li>
    </ul>

    <div class="actions">
      <button
        type="button"
        class="attach"
        aria-label="Attach a PDF or photos"
        title="Attach a PDF or photos"
        @click="picker?.click()"
      >
        <Icon name="plus" :size="22" />
      </button>
      <input
        ref="picker"
        type="file"
        hidden
        multiple
        :accept="ACCEPT.join(',')"
        @change="
          add(($event.target as HTMLInputElement).files)
          ;($event.target as HTMLInputElement).value = ''
        "
      />
      <span class="hint">{{
        failed
          ? "Remove the file that could not be read, then send."
          : note || hint
      }}</span>
      <button
        type="submit"
        class="send"
        :disabled="!canSend || sending"
        :aria-label="
          busy ? 'The AI is working' : sending ? 'Uploading the files' : 'Send'
        "
      >
        <Icon name="send" :size="20" />
      </button>
    </div>
  </form>
</template>

<style scoped>
.box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 16px 12px;
  border: 2px solid var(--ink);
  border-radius: var(--radius-xl);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  transition:
    border-color var(--fast),
    box-shadow var(--fast);

  &:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 15%, transparent);
  }

  &[data-dragging] {
    border-style: dashed;
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 5%, var(--surface));
  }

  &[data-compact] {
    padding: 10px 10px 8px 14px;
    border-width: 1.5px;
    border-radius: var(--radius-xl);

    textarea {
      min-height: 24px;
      font-size: 16px;
    }
    .attach,
    .send {
      width: 36px;
      height: 36px;
      border-radius: var(--radius-lg);
    }
  }
}

textarea {
  min-height: 64px;
  max-height: 240px;
  field-sizing: content;
  resize: none;
  border: 0;
  outline: none;
  background: none;
  font: inherit;
  font-size: 20px;
  line-height: 1.4;
  color: var(--ink);

  &::placeholder {
    color: var(--muted);
  }
}

.files {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    padding: 4px 4px 4px 10px;
    border-radius: var(--radius-md);
    background: var(--sunken);
    font-size: 14px;
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  small {
    flex: none;
    max-width: 60%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
  }
  li[data-state="failed"] {
    background: var(--bad-soft);

    small {
      flex: 1;
      white-space: normal;
      color: var(--bad);
    }
  }
  button {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: var(--radius-tile);
    background: none;
    cursor: pointer;
    color: inherit;

    &:hover {
      background: var(--hover);
    }
  }
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* A file on its way up, or being read: the builder's three dots, small. */
.dots {
  display: inline-flex;
  flex: none;
  gap: 3px;
  width: 16px;
  justify-content: center;

  i {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--accent);
    animation: blink 1.2s infinite ease-in-out both;
  }
  i:nth-child(2) {
    animation-delay: 0.15s;
  }
  i:nth-child(3) {
    animation-delay: 0.3s;
  }
}
@keyframes blink {
  0%,
  80%,
  100% {
    opacity: 0.25;
    transform: scale(0.8);
  }
  40% {
    opacity: 1;
    transform: scale(1);
  }
}

.attach,
.send {
  display: grid;
  place-items: center;
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-lg);
  cursor: pointer;
}

.attach {
  border: 0;
  background: none;
  color: var(--ink);

  &:hover {
    background: var(--hover);
  }
}

.hint {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  color: var(--muted);
}

.send {
  border: 0;
  background: var(--accent);
  color: var(--accent-ink);

  &:disabled {
    background: var(--sunken);
    color: color-mix(in srgb, var(--ink) 35%, transparent);
    cursor: default;
  }
}

@media (max-width: 767px) {
  textarea {
    font-size: 17px;
  }
}
</style>
