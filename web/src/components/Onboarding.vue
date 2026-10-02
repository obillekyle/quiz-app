<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import { useRouter } from "vue-router"
import Icon from "./Icon.vue"
import { useAuth } from "../composables/auth"
import { useOnboarding } from "../composables/onboarding"

/** Four steps on what the app does, in the order a teacher meets them, each with a small drawing of the screen it describes. */
const STEPS = [
  {
    title: "Start from your material.",
    text: "Attach a module as a PDF, or photos of a handout, and say what the quiz needs. The AI drafts the questions from it while you watch.",
  },
  {
    title: "Check every question.",
    text: "Each question shows the sentence it came from, with its file and page. One marked “Not found in the file” needs a look before you share. Change anything by hand or by chat.",
  },
  {
    title: "Share it or print it.",
    text: "People answer by link or QR code with a name and no account. On paper it prints as Set A and Set B, with an answer key and a table of specifications.",
  },
  {
    title: "See what to teach again.",
    text: "Results show the questions missed most and a short note from the AI. Every AI verdict is labeled, and you can change any score.",
  },
] as const

const router = useRouter()
const { userdata } = useAuth()
const { open, done } = useOnboarding()

const dialog = ref<HTMLDialogElement>()
const at = ref(0)
const step = computed(() => STEPS[at.value]!)
const last = computed(() => at.value === STEPS.length - 1)

watch(
  open,
  async (is) => {
    await nextTick()
    if (is && !dialog.value?.open) {
      at.value = 0
      dialog.value?.showModal()
    } else if (!is && dialog.value?.open) dialog.value.close()
  },
  { immediate: true },
)

const close = () => done(userdata.value?.id)
function next() {
  if (!last.value) return void at.value++
  close()
  router.push({ name: "home", query: { new: "1" } })
}
function onKey(e: KeyboardEvent) {
  if (e.key === "ArrowRight" && !last.value) at.value++
  else if (e.key === "ArrowLeft" && at.value) at.value--
}
</script>

<template>
  <dialog
    ref="dialog"
    class="onboarding"
    aria-labelledby="onboarding-title"
    @cancel.prevent="close"
    @keydown="onKey"
  >
    <div class="art" :data-step="at" aria-hidden="true">
      <Transition name="art" mode="out-in">
        <!-- The prompt box with a file attached. -->
        <div v-if="at === 0" key="a" class="scene">
          <div class="box">
            <span class="ghost">15 questions for Grade 7, mixed kinds</span>
            <span class="row">
              <span class="chip"
                ><Icon name="file" :size="14" /> science7-metals.pdf</span
              >
              <span class="send"><Icon name="up" :size="16" /></span>
            </span>
          </div>
        </div>
        <!-- A question with its source sentence. -->
        <div v-else-if="at === 1" key="b" class="scene">
          <div class="card">
            <b>Which metal is liquid at room temperature?</b>
            <span class="opt right">B. Mercury</span>
            <span class="source">
              <span class="found"
                ><Icon name="check" :size="12" /> Found in the file, page
                1</span
              >
              “Mercury is the only metal that is liquid at room temperature.”
            </span>
          </div>
        </div>
        <!-- A link, a code, a printed page. -->
        <div v-else-if="at === 2" key="c" class="scene share">
          <span class="qr"><i v-for="n in 16" :key="n" /></span>
          <span class="stack">
            <span class="chip"
              ><Icon name="link" :size="14" /> quiz.okyle.dev/q/8FSqvXwx</span
            >
            <span class="chip"
              ><Icon name="print" :size="14" /> Set A · Set B · Answer key</span
            >
          </span>
        </div>
        <!-- The questions missed most. -->
        <div v-else key="d" class="scene">
          <div class="card">
            <span class="miss"
              ><em>Q5</em><i style="--w: 75%" /><small>9 of 12</small></span
            >
            <span class="miss"
              ><em>Q3</em><i style="--w: 42%" /><small>5 of 12</small></span
            >
            <span class="miss"
              ><em>Q7</em><i style="--w: 25%" /><small>3 of 12</small></span
            >
            <span class="note"
              ><span class="ai">AI</span> Q5 and Q3 both turn on alloys. Go over
              them again.</span
            >
          </div>
        </div>
      </Transition>
    </div>

    <div class="body">
      <p class="count">
        {{ at === 0 ? "Welcome to QuizApp · " : "" }}Step {{ at + 1 }} of
        {{ STEPS.length }}
      </p>
      <h2 id="onboarding-title">{{ step.title }}</h2>
      <p class="text">{{ step.text }}</p>
    </div>

    <div class="dots" aria-hidden="true">
      <i v-for="(_, i) in STEPS" :key="i" :data-on="i === at || undefined" />
    </div>

    <div class="actions">
      <button
        v-if="!last"
        type="button"
        btn="quiet"
        class="skip"
        @click="close"
      >
        Skip
      </button>
      <button v-if="at" type="button" btn @click="at--">Back</button>
      <button type="button" btn="primary" autofocus @click="next">
        {{ last ? "Make a quiz" : "Next" }}
      </button>
    </div>
  </dialog>
</template>

<style scoped>
.onboarding {
  width: min(92vw, 480px);
  padding: 0;
  border: 0;
  border-radius: var(--radius-3xl);
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--shadow-md);
  overflow: hidden;

  &::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  &[open] {
    animation: arrive 0.28s var(--ease) both;
  }
}
@keyframes arrive {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.98);
  }
}

.art {
  display: grid;
  place-items: center;
  height: 216px;
  padding: 16px 20px;
  background: color-mix(in srgb, var(--accent) 10%, var(--surface));
  transition: background 0.3s var(--ease);

  &[data-step="2"] {
    background: color-mix(in srgb, var(--student) 10%, var(--surface));
  }
  &[data-step="3"] {
    background: color-mix(in srgb, var(--good) 12%, var(--surface));
  }
}
.art-enter-active,
.art-leave-active {
  transition:
    opacity 0.16s var(--ease),
    transform 0.16s var(--ease);
}
.art-enter-from {
  opacity: 0;
  transform: translateX(14px);
}
.art-leave-to {
  opacity: 0;
  transform: translateX(-14px);
}

.scene {
  display: grid;
  width: min(100%, 360px);
  font-size: 13px;
  text-align: left;
}
.box,
.card {
  display: grid;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  background: var(--surface);
  box-shadow: var(--shadow-sm, 0 1px 3px rgb(0 0 0 / 0.08));
}
.ghost {
  color: var(--muted);
  font-size: 14px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 5px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-full);
  background: var(--surface);
  font-weight: 500;
  white-space: nowrap;
}
.send {
  display: grid;
  flex: none;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-md);
  background: var(--accent);
  color: var(--accent-ink);
}
.card b {
  font-size: 14px;
}
.opt {
  padding: 6px 10px;
  border: 1px solid color-mix(in srgb, var(--good) 45%, transparent);
  border-radius: var(--radius-md);
  background: var(--good-soft);
}
.source {
  display: grid;
  gap: 4px;
  padding-left: 10px;
  border-left: 3px solid var(--accent);
  color: var(--muted);
  font-style: italic;
  font-size: 12px;
}
.found {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--good);
  font-style: normal;
  font-weight: 600;
}
.share {
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 16px;
}
.qr {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  width: 92px;
  height: 92px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--surface);

  i {
    border-radius: 2px;
    background: var(--ink);
  }
  i:nth-child(3n + 2),
  i:nth-child(7) {
    background: none;
  }
}
.stack {
  display: grid;
  gap: 8px;
  justify-items: start;
  min-width: 0;
}
.miss {
  display: grid;
  grid-template-columns: 26px 1fr auto;
  align-items: center;
  gap: 8px;

  em {
    font-style: normal;
    font-weight: 600;
  }
  i {
    height: 8px;
    border-radius: 4px;
    background: linear-gradient(
      to right,
      var(--bad) var(--w),
      color-mix(in srgb, var(--ink) 10%, transparent) var(--w)
    );
  }
  small {
    color: var(--muted);
  }
}
.note {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 12px;
}
.ai {
  flex: none;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--accent) 14%, var(--surface));
  color: var(--ink);
  font-size: 11px;
  font-weight: 700;
}

.body {
  padding: 22px 24px 0;
}
.count {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
}
h2 {
  margin: 6px 0 0;
  font-size: 22px;
  letter-spacing: -0.01em;
}
.text {
  margin: 8px 0 0;
  min-height: 6em;
  line-height: 1.5;
  color: color-mix(in srgb, var(--ink) 75%, transparent);
}

.dots {
  display: flex;
  justify-content: center;
  gap: 6px;
  padding: 14px 0 0;

  i {
    width: 6px;
    height: 6px;
    border-radius: 3px;
    background: color-mix(in srgb, var(--ink) 18%, transparent);
    transition:
      width 0.2s var(--ease),
      background 0.2s var(--ease);
  }
  i[data-on] {
    width: 18px;
    background: var(--accent);
  }
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 24px 22px;

  button {
    min-height: 44px;
    padding: 0 20px;
  }
  .skip {
    margin-right: auto;
    padding: 0 12px;
  }
}

@media (max-width: 480px) {
  .art {
    height: 200px;
    padding: 12px;
  }
  .body {
    padding: 18px 18px 0;
  }
  .actions {
    padding: 14px 18px 18px;
  }
  .qr {
    width: 76px;
    height: 76px;
    padding: 8px;
  }
}
</style>
