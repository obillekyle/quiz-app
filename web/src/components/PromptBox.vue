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
    /** The AI is working: sending is off, and the box shows the work. */
    busy?: boolean
    /** Sending is off with no work to show: the page is loading or saving. */
    off?: boolean
    /** A smaller box for the chat panel. */
    compact?: boolean
  }>(),
  {
    placeholder: "Create your new quiz…",
    hint: "",
    busy: false,
    off: false,
    compact: false,
  },
)

const emit = defineEmits<{
  send: [text: string, sources: number[], names: string[]]
}>()

const text = ref("")
/** The box's name for assistive tech: the placeholder without its full stop. */
const label = computed(() => props.placeholder.replace(/[.…]+$/, ""))
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
/** Work is going on: the AI on the ask, or a file going up or being read. */
const working = computed(
  () =>
    props.busy ||
    uploads.value.some((u) => u.state === "uploading" || u.state === "reading"),
)
const canSend = computed(
  () =>
    !props.busy &&
    !props.off &&
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
/** Puts a ready-made ask in the box, to send or to change first. */
function fill(t: string) {
  text.value = t
  focus()
}

defineExpose({ clear, focus, fill })
</script>

<template>
  <form
    class="box"
    :data-compact="compact || undefined"
    :data-dragging="dragging || undefined"
    :data-busy="working || undefined"
    @submit.prevent="send"
    @dragover.prevent="dragging = true"
    @dragleave.self="dragging = false"
    @drop.prevent="onDrop"
  >
    <!-- Behind the box, four colored shadows; on its edge, the ring that
         turns while work is going on. -->
    <i class="glow" aria-hidden="true"><i /><i /><i /><i /></i>
    <i class="ring" aria-hidden="true" />
    <textarea
      ref="field"
      v-model="text"
      :rows="compact ? 1 : 2"
      :placeholder="placeholder"
      :aria-label="label"
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
        :disabled="busy"
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
/* The ring's angle, registered so it can be animated. */
@property --angle {
  syntax: "<angle>";
  inherits: false;
  initial-value: 0deg;
}

/*
 * Three looks. At rest a 1px line. With the cursor in it a 1.5px outline in
 * the ink's own gray, and on the home page's big box four colored shadows
 * behind it. While work is going on (the AI, or a file going up) a ring in
 * the brand's colors turns on the edge and the shadows breathe and drift,
 * on both boxes.
 *
 * The box is a stack of its own, bottom to top: the shadows, the face (the
 * surface and its line), the outline and the ring, the controls. The face is
 * a layer and not the form's own background so the shadows can sit under it
 * without sliding under the page as well.
 */
.box {
  --glow-orange: #ff7a1a;
  --glow-magenta: #c04be0;
  --glow-blue: #3d8bff;
  --glow-amber: #ffb224;
  --brown: var(--accent);
  --purple: var(--student);
  --orange: #ef6c00;
  --blue: #2f6fdb;
  /* The ring's width. */
  --rw: 2px;
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 18px 18px 14px;
  border-radius: var(--radius-xl);

  &::before,
  &::after,
  .ring,
  .glow,
  .glow i {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
  }

  /* The face. */
  &::before {
    content: "";
    z-index: -1;
    border: 1px solid var(--line);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }

  /* The outline of a box with the cursor in it: neutral, 150 ms in. It
     gives way to the ring while work is going on. An inset shadow and not a
     border: a border of 1.5px is drawn as 1px on a screen of one device
     pixel to the CSS pixel, the same as the resting line. */
  &::after {
    content: "";
    z-index: 0;
    box-shadow: inset 0 0 0 1.5px
      color-mix(in srgb, var(--ink) 55%, transparent);
    opacity: 0;
    transition: opacity var(--fast) var(--ease);
  }
  &:focus-within::after {
    opacity: 1;
  }
  &[data-busy]::after {
    opacity: 0;
    transition-duration: 300ms;
  }

  /* The ring: the brand's colors around the edge, masked to a band as wide
     as --rw. It turns once every 3 s while work is going on, and is paused
     rather than removed when the work ends, so its 300 ms fade starts from
     wherever it was. The gradient is written here and not handed down in a
     variable: a variable holding var(--angle) is resolved on the element
     that declares it, and the ring would inherit a gradient stuck at 0deg. */
  .ring {
    z-index: 0;
    padding: var(--rw);
    /* Brighter relatives of the brand colors: the brown and the purple read
       near black in a 1.5px line and gray in a blurred shadow. */
    background: conic-gradient(
      from var(--angle),
      var(--glow-orange),
      var(--glow-magenta),
      var(--glow-blue),
      var(--glow-amber),
      var(--glow-orange)
    );
    mask:
      linear-gradient(#000 0 0) content-box,
      linear-gradient(#000 0 0);
    mask-composite: exclude;
    opacity: 0;
    animation: turn 3s linear infinite paused;
    transition: opacity 300ms var(--ease);
  }
  &[data-busy] .ring {
    opacity: 1;
    animation-play-state: running;
  }

  /* The shadows: one layer a color, each a soft drop shadow thrown its own
     way (purple down and left, orange up and right, brown below, blue up and
     left). A layer is 21px smaller than the box all round with the spread
     21px larger, so the shadow is the box's own while the layer, which moves,
     never reaches past the box and never adds to what the page scrolls.

     While work is going on each layer goes round the box on a circle as wide
     as its throw, once every 12 s, without turning itself (turning a layer
     as wide as the box would swing it across the page), and breathes between
     70% and full every 2 s. Only transform and opacity change; the shadows
     are drawn once. Paused, not removed, when the work ends. Under reduced
     motion both are over at once and the shadows stay where they rest. */
  .glow {
    z-index: -2;
    opacity: 0;
    transition: opacity 300ms var(--ease);

    i {
      inset: 21px;
      box-shadow: 0 0 var(--blur) calc(var(--spread) + 21px)
        color-mix(in srgb, var(--c) 62%, transparent);
      transform: rotate(var(--a)) translateX(var(--r))
        rotate(calc(-1 * var(--a)));
      animation:
        drift 12s linear infinite paused,
        breathe 2s ease-in-out infinite paused;
    }
    /* -18px 10px 44px -10px */
    i:nth-child(1) {
      --c: var(--glow-magenta);
      --a: 150.95deg;
      --r: 20.6px;
      --blur: 44px;
      --spread: -10px;
    }
    /* 18px -10px 44px -10px */
    i:nth-child(2) {
      --c: var(--glow-orange);
      --a: -29.05deg;
      --r: 20.6px;
      --blur: 44px;
      --spread: -10px;
    }
    /* 0 18px 48px -12px */
    i:nth-child(3) {
      --c: var(--glow-amber);
      --a: 90deg;
      --r: 18px;
      --blur: 48px;
      --spread: -12px;
    }
    /* -10px -14px 40px -12px */
    i:nth-child(4) {
      --c: var(--glow-blue);
      --a: 234.46deg;
      --r: 17.2px;
      --blur: 40px;
      --spread: -12px;
    }
  }
  /* The big box with the cursor in it: the shadows, still, 200 ms in. */
  /* Softer than the working state, so work reads as the stronger of the two. */
  &:not([data-compact], [data-busy]):focus-within .glow {
    opacity: 0.6;
    transition-duration: 200ms;
  }
  &[data-busy] .glow {
    opacity: 1;
    transition-duration: 300ms;

    i {
      animation-play-state: running;
    }
  }

  > :not(.ring, .glow) {
    position: relative;
    z-index: 1;
  }

  &[data-dragging]::before {
    border: 2px dashed var(--accent);
    background: color-mix(in srgb, var(--accent) 5%, var(--surface));
  }

  &[data-compact] {
    --rw: 1.5px;
    padding: 11.5px 11.5px 9.5px 15.5px;

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
    opacity: 1;
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

  &:hover:not(:disabled) {
    background: var(--hover);
  }
  /* Off with the send button while the AI works, and as dim. */
  &:disabled {
    color: color-mix(in srgb, var(--ink) 35%, transparent);
    cursor: default;
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
  /* A finger's size for the attach and the send, the compact box included;
     the file chip's cross keeps its 24px and gets 44 to tap. */
  .box[data-compact] .attach,
  .box[data-compact] .send {
    width: 44px;
    height: 44px;
  }
  .files button {
    position: relative;

    &::after {
      content: "";
      position: absolute;
      inset: -10px;
    }
  }
}

@keyframes turn {
  to {
    --angle: 360deg;
  }
}
@keyframes drift {
  to {
    transform: rotate(calc(var(--a) + 1turn)) translateX(var(--r))
      rotate(calc(-1 * var(--a) - 1turn));
  }
}
/* From full, so a paused breath (the big box with the cursor in it) is full. */
@keyframes breathe {
  50% {
    opacity: 0.7;
  }
}
</style>
