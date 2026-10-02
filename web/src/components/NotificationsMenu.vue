<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue"
import { useRouter } from "vue-router"
import Icon from "./Icon.vue"
import { api } from "../composables/api"

type Item = {
  id: string
  kind: "response" | "report"
  quiz: string
  title: string
  detail: string | null
  at: number
  to: string
  unread: boolean
}

const router = useRouter()
const items = ref<Item[]>([])
const unread = ref(0)
const failed = ref("")
const panel = ref<HTMLElement>()

async function load() {
  try {
    const r = await api<{ items: Item[]; unread: number }>("/notifications")
    items.value = r.items
    unread.value = r.unread
    failed.value = ""
  } catch (e) {
    failed.value = e instanceof Error ? e.message : String(e)
  }
}

let timer: number | undefined
onMounted(() => {
  load()
  timer = window.setInterval(load, 60_000)
})
onBeforeUnmount(() => clearInterval(timer))

/** Opening the panel reads what is in it; the dots stay until it closes. */
async function toggled(e: Event) {
  if ((e as ToggleEvent).newState !== "open") {
    items.value = items.value.map((i) => ({ ...i, unread: false }))
    return
  }
  await load()
  if (unread.value) {
    unread.value = 0
    api("/notifications/seen", { method: "POST" }).catch(() => {})
  }
}

function open(i: Item) {
  panel.value?.hidePopover()
  router.push(i.to)
}

function when(seconds: number) {
  const at = new Date(seconds * 1000)
  const today = new Date()
  const midnight = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  // Rounded, since a day that changes the clock is 23 or 25 hours long.
  const days = Math.round((midnight(today) - midnight(at)) / 86_400_000)
  if (days <= 0)
    return at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  if (days === 1) return "Yesterday"
  return at.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: at.getFullYear() === today.getFullYear() ? undefined : "numeric",
  })
}
const iso = (seconds: number) => new Date(seconds * 1000).toISOString()
</script>

<template>
  <button
    class="bell"
    popovertarget="notifications"
    :aria-label="unread ? `Notifications, ${unread} new` : 'Notifications'"
    :title="unread ? `${unread} new` : 'Notifications'"
  >
    <Icon name="bell" />
    <span v-if="unread" class="dot" aria-hidden="true" />
  </button>
  <div id="notifications" ref="panel" class="panel" popover @toggle="toggled">
    <h2>Notifications</h2>
    <p v-if="failed" class="note" role="alert">{{ failed }}</p>
    <p v-else-if="!items.length" class="note">
      Nothing yet. Finished responses and reports on your quizzes show here.
    </p>
    <ul v-else stack>
      <li v-for="i in items" :key="i.id" :data-unread="i.unread || undefined">
        <button type="button" @click="open(i)">
          <span class="mark" :data-kind="i.kind" aria-hidden="true">
            <Icon :name="i.kind === 'report' ? 'flag' : 'done'" :size="18" />
          </span>
          <span class="what">
            <span class="head">
              <strong>{{ i.title }}</strong>
              <time :datetime="iso(i.at)">{{ when(i.at) }}</time>
            </span>
            <span class="sub"
              >{{ i.quiz
              }}<template v-if="i.detail"> · {{ i.detail }}</template></span
            >
          </span>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.bell {
  position: relative;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: var(--radius-lg);
  background: none;
  color: color-mix(in srgb, var(--ink) 70%, transparent);
  cursor: pointer;

  &:hover {
    background: var(--hover);
  }
  &:focus-visible {
    outline: 2px solid var(--accent);
  }
}
.dot {
  position: absolute;
  top: 9px;
  right: 9px;
  width: 9px;
  height: 9px;
  border: 2px solid var(--surface);
  border-radius: 50%;
  background: var(--bad);
}

.panel {
  position: fixed;
  inset: auto;
  top: 64px;
  right: 16px;
  width: min(380px, calc(100vw - 24px));
  max-height: min(560px, calc(100dvh - 80px));
  margin: 0;
  padding: 14px;
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius-2xl);
  background: var(--bg);
  color: var(--ink);
  box-shadow: var(--shadow-md);

  h2 {
    margin: 0 4px 10px;
    font-size: 16px;
  }
}
.note {
  margin: 0 4px 6px;
  font-size: 14px;
  color: var(--muted);
}
li button {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
  min-height: 60px;
  padding: 10px 12px;
  border: 0;
  border-radius: inherit;
  background: none;
  color: var(--ink);
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--hover);
  }
}
li[data-unread] {
  background: color-mix(in srgb, var(--accent) 7%, var(--surface));

  strong::after {
    content: "";
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-left: 6px;
    border-radius: 50%;
    background: var(--accent);
    vertical-align: 2px;
  }
}
.mark {
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--accent) 12%, var(--surface));
  color: var(--accent);

  &[data-kind="report"] {
    background: color-mix(in srgb, var(--bad) 12%, var(--surface));
    color: var(--bad);
  }
}
.what {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  font-size: 14px;
}
.head {
  display: flex;
  align-items: baseline;
  gap: 8px;

  strong {
    flex: 1;
    min-width: 0;
    font-weight: 600;
  }
  time {
    flex: none;
    font-size: 12px;
    color: var(--muted);
    white-space: nowrap;
  }
}
.sub {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  font-size: 13px;
  color: var(--muted);
  overflow-wrap: anywhere;
}

@media (max-width: 767px) {
  .bell {
    width: 44px;
    height: 44px;
  }
  .dot {
    top: 10px;
    right: 10px;
  }
  .panel {
    top: 64px;
    right: 12px;
    left: 12px;
    width: auto;
  }
}
</style>
