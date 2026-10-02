<script setup lang="ts">
import { Icon as Iconify } from "@iconify/vue"
import { computed, onBeforeUnmount, ref, watch } from "vue"
import Icon from "./Icon.vue"

const props = defineProps<{ current: string | null }>()
const emit = defineEmits<{ pick: [id: string] }>()

const API = "https://api.iconify.design/search"
/** The colorful sets, in the order an emoji drawn in several is taken from. */
const COLORFUL = ["fluent-emoji-flat", "noto", "twemoji"]
const SHOWN = 24
/** Before anything is typed: one subject each, from Fluent's flat emoji. */
const STARTERS = [
  "test-tube",
  "books",
  "abacus",
  "globe-showing-asia-australia",
  "dna",
  "triangular-ruler",
  "microscope",
  "scroll",
  "artist-palette",
  "musical-notes",
  "laptop",
  "brain",
  "bar-chart",
  "memo",
  "light-bulb",
  "atom-symbol",
  "input-numbers",
  "world-map",
  "leaf-fluttering-in-wind",
  "money-bag",
  "stethoscope",
  "graduation-cap",
  "classical-building",
  "magnet",
].map((n) => `fluent-emoji-flat:${n}`)
const ICON_ID = /^[a-z0-9-]+:[a-z0-9-]+$/

const query = ref("")
const results = ref<string[]>(STARTERS)
const state = ref<"idle" | "searching" | "empty" | "failed">("idle")
let timer: number | undefined
let controller: AbortController | undefined

async function search(q: string) {
  controller?.abort()
  controller = new AbortController()
  const { signal } = controller
  state.value = "searching"
  const url = (extra: string) =>
    `${API}?query=${encodeURIComponent(q)}&limit=${extra}`
  try {
    const [color, all] = await Promise.all(
      [url(`64&prefixes=${COLORFUL.join(",")}`), url("32")].map((u) =>
        fetch(u, { signal }).then((r) => {
          if (!r.ok) throw new Error(String(r.status))
          return r.json() as Promise<{ icons: string[] }>
        }),
      ),
    )
    const byName = new Map<string, string>()
    for (const id of color!.icons) {
      const [set, name] = id.split(":") as [string, string]
      const had = byName.get(name)
      if (!had || COLORFUL.indexOf(set) < COLORFUL.indexOf(had.split(":")[0]!))
        byName.set(name, id)
    }
    const out = [...byName.values()]
    for (const id of all!.icons)
      if (out.length < SHOWN && !COLORFUL.includes(id.split(":")[0]!))
        out.push(id)
    results.value = out.slice(0, SHOWN)
    state.value = out.length ? "idle" : "empty"
  } catch (e) {
    if (signal.aborted) return
    results.value = []
    state.value = "failed"
  }
}

watch(query, (q) => {
  clearTimeout(timer)
  const text = q.trim()
  if (!text) {
    controller?.abort()
    results.value = STARTERS
    state.value = "idle"
    return
  }
  timer = window.setTimeout(() => search(text), 280)
})
onBeforeUnmount(() => {
  clearTimeout(timer)
  controller?.abort()
})

// ---- an id typed or pasted -------------------------------------------------------
const typed = ref(props.current ?? "")
watch(
  () => props.current,
  (c) => (typed.value = c ?? ""),
)
const typedValid = computed(() => ICON_ID.test(typed.value.trim()))
const typedError = ref("")
function useTyped() {
  const id = typed.value.trim()
  typedError.value = ""
  if (!id || id === props.current) return
  if (!ICON_ID.test(id) || id.length > 80) {
    typedError.value =
      "Use an id in the form set:name, such as fluent-emoji-flat:test-tube."
    return
  }
  emit("pick", id)
}

/** "test tube", for a button's name: the icon's own name in words. */
const words = (id: string) => id.split(":")[1]!.replace(/-/g, " ")
</script>

<template>
  <div class="picker">
    <label class="search">
      <Icon name="search" :size="18" />
      <input
        v-model="query"
        type="search"
        placeholder="Search icons, such as microscope or globe"
        aria-label="Search icons"
        autocomplete="off"
        spellcheck="false"
      />
    </label>
    <p class="status" aria-live="polite">
      <template v-if="state === 'searching'">Searching…</template>
      <template v-else-if="state === 'empty'"
        >No icons match “{{ query.trim() }}”. Try one plain word in
        English.</template
      >
      <template v-else-if="state === 'failed'"
        >The icon search could not be reached. Type an icon id below
        instead.</template
      >
      <template v-else-if="!query.trim()"
        >A few to start with. A word searches every Iconify set.</template
      >
    </p>
    <div v-if="results.length" class="grid">
      <button
        v-for="id in results"
        :key="id"
        type="button"
        class="choice"
        :aria-pressed="id === current"
        :aria-label="words(id)"
        :title="id"
        @click="emit('pick', id)"
      >
        <Iconify :icon="id" :width="30" :height="30" />
      </button>
    </div>

    <details class="typed" :open="!!typedError || undefined">
      <summary>
        <Icon name="chevron" :size="18" class="chev" /> Use an icon id
      </summary>
      <label for="icon-id">Icon id</label>
      <div class="typed-row">
        <span class="preview" aria-hidden="true">
          <Iconify
            v-if="typedValid"
            :icon="typed.trim()"
            :width="26"
            :height="26"
          />
        </span>
        <input
          id="icon-id"
          v-model="typed"
          field
          placeholder="fluent-emoji-flat:test-tube"
          autocomplete="off"
          spellcheck="false"
          :aria-invalid="!!typedError || undefined"
          @blur="useTyped"
          @keydown.enter.prevent="useTyped"
        />
      </div>
      <p v-if="typedError" class="error" role="alert">{{ typedError }}</p>
      <p v-else class="hint">
        Any id from
        <a
          href="https://icon-sets.iconify.design/"
          target="_blank"
          rel="noopener"
          >Iconify's sets</a
        >
        works here, in the form set:name.
      </p>
    </details>
  </div>
</template>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 14px;
  border: 1px solid color-mix(in srgb, var(--ink) 18%, transparent);
  border-radius: var(--radius-md);
  background: var(--surface);
  color: var(--muted);

  &:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
    border-color: transparent;
  }
  input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    font: inherit;
    color: var(--ink);
    outline: none;
  }
}
.status {
  min-height: 20px;
  margin: 0;
  font-size: 13px;
  color: var(--muted);

  &:empty {
    display: none;
  }
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(48px, 1fr));
  gap: 4px;
}
.choice {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  min-height: 48px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-lg);
  background: var(--sunken);
  color: var(--ink);
  cursor: pointer;
  transition: background var(--fast) var(--ease);

  &:hover {
    background: var(--hover);
  }
  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  &[aria-pressed="true"] {
    background: color-mix(in srgb, var(--accent) 16%, var(--surface));
    box-shadow: inset 0 0 0 2px var(--accent);
  }
}
.typed {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;

  summary {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    list-style: none;
    font-size: 14px;
    font-weight: 600;
    color: var(--accent);
    cursor: pointer;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  .chev {
    rotate: -90deg;
    transition: rotate var(--fast) var(--ease);
  }
  &[open] .chev {
    rotate: 0deg;
  }
  label {
    display: block;
    margin-bottom: 6px;
    font-size: 13px;
    font-weight: 600;
  }
  .typed-row + p {
    margin-top: 6px;
  }
}
.typed-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.preview {
  display: grid;
  flex: none;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-lg);
  background: var(--sunken);
}
.hint,
.error {
  margin: 0;
  font-size: 13px;
  color: var(--muted);

  a {
    color: var(--accent);
  }
}
.error {
  color: var(--bad);
}
</style>
