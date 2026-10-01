<script setup lang="ts">
import { addIcon, Icon as Iconify } from "@iconify/vue"
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useRoute } from "vue-router"
import ConfirmDialog from "../components/ConfirmDialog.vue"
import Icon from "../components/Icon.vue"
import LogoMark from "../components/LogoMark.vue"
import TakeItem from "../components/TakeItem.vue"
import { ApiError } from "../composables/api"
import {
  dropAttempt,
  dropPace,
  countVisit,
  endVisit,
  heldAttempt,
  holdAttempt,
  markDone,
  readPace,
  savePace,
  takeApi,
  wasDone,
  type Attempt,
  type Given,
  type Held,
  type PublicQuiz,
} from "../composables/take"

/*
 * A shared quiz, answered with a name and no account: the respondent's side
 * of QuizApp, in the design's purple (Figma, the five phone screens of
 * `123120.png`). Intro, then the name, then one question at a time with
 * feedback after each, then the score, a rating and a review.
 *
 * The attempt's id and token stay in this browser (localStorage), so a
 * refresh or a closed tab picks up at the first unanswered question.
 *
 * The quiz's settings shape it: the order comes from the attempt's saved
 * layout; a time limit runs a clock (per question it moves on at zero,
 * overall it finishes); one attempt per browser keeps a finished quiz
 * finished; held results replace the score with "Your answers are in" and
 * an email to tell when they are released.
 */

// Material Symbols (Google, Apache 2.0), the set the app's own icons come
// from, for the clock and the rules on the intro. Registered here rather than
// in the app's generated set, which only this page needs them from.
addIcon("take:timer", {
  body: '<path fill="currentColor" d="M10 3q-.425 0-.712-.288T9 2t.288-.712T10 1h4q.425 0 .713.288T15 2t-.288.713T14 3zm2.713 10.713Q13 13.425 13 13V9q0-.425-.288-.712T12 8t-.712.288T11 9v4q0 .425.288.713T12 14t.713-.288m-4.2 7.576q-1.638-.713-2.863-1.938t-1.937-2.863T3 13t.713-3.488T5.65 6.65t2.863-1.937T12 4q1.55 0 2.975.5t2.675 1.45l.7-.7q.275-.275.7-.275t.7.275t.275.7t-.275.7l-.7.7Q20 8.6 20.5 10.025T21 13q0 1.85-.713 3.488T18.35 19.35t-2.863 1.938T12 22t-3.488-.712m8.438-3.338Q19 15.9 19 13t-2.05-4.95T12 6T7.05 8.05T5 13t2.05 4.95T12 20t4.95-2.05M12 13"/>',
  width: 24,
  height: 24,
})
addIcon("take:lock", {
  body: '<path fill="currentColor" d="M6 22q-.825 0-1.412-.587T4 20V10q0-.825.588-1.412T6 8h1V6q0-2.075 1.463-3.537T12 1t3.538 1.463T17 6v2h1q.825 0 1.413.588T20 10v10q0 .825-.587 1.413T18 22zm0-2h12V10H6zm7.413-3.588Q14 15.826 14 15t-.587-1.412T12 13t-1.412.588T10 15t.588 1.413T12 17t1.413-.587M9 8h6V6q0-1.25-.875-2.125T12 3t-2.125.875T9 6zM6 20V10z"/>',
  width: 24,
  height: 24,
})
addIcon("take:hourglass", {
  body: '<path fill="currentColor" d="M8 20h8v-3q0-1.65-1.175-2.825T12 13t-2.825 1.175T8 17zm6.825-10.175Q16 8.65 16 7V4H8v3q0 1.65 1.175 2.825T12 11t2.825-1.175M5 22q-.425 0-.712-.288T4 21t.288-.712T5 20h1v-3q0-1.525.713-2.863T8.7 12q-1.275-.8-1.987-2.137T6 7V4H5q-.425 0-.712-.288T4 3t.288-.712T5 2h14q.425 0 .713.288T20 3t-.288.713T19 4h-1v3q0 1.525-.712 2.863T15.3 12q1.275.8 1.988 2.138T18 17v3h1q.425 0 .713.288T20 21t-.288.713T19 22z"/>',
  width: 24,
  height: 24,
})
addIcon("take:mail-read", {
  body: '<path fill="currentColor" d="m4 6l8 5l8-5zm0 14q-.825 0-1.412-.587T2 18V6q0-.825.588-1.412T4 4h16q.825 0 1.413.588T22 6v5q0 .425-.288.713T21 12t-.712-.288T20 11V8l-7.475 4.675q-.075.05-.525.15q-.125 0-.262-.037t-.263-.113L4 8v10h5.5q.425 0 .713.288T10.5 19t-.288.713T9.5 20zm11.95-.8l4.95-4.95q.275-.275.7-.275t.7.275t.275.7t-.275.7l-5.65 5.65q-.3.3-.7.3t-.7-.3l-2.85-2.85q-.275-.275-.275-.7t.275-.7t.7-.275t.7.275z"/>',
  width: 24,
  height: 24,
})

const route = useRoute()
const code = String(route.params.code)

type Stage =
  "loading" | "missing" | "intro" | "question" | "done" | "review" | "taken"
const stage = ref<Stage>("loading")
const loadError = ref("")
const quiz = ref<PublicQuiz>()
const held = ref<Held | null>(heldAttempt(code))
const state = ref<Attempt | null>(null)

const info = computed(() => quiz.value?.quiz)
const timeMode = computed(() => info.value?.timeMode ?? "none")
const limitMs = computed(() => (info.value?.timeLimit ?? 0) * 1000)
const allowRetake = computed(() => info.value?.allowRetake ?? true)
const showHints = computed(() => info.value?.showHints ?? true)
const aiCheck = computed(() => info.value?.aiCheck ?? true)
const aiEssay = computed(() => info.value?.aiEssay ?? true)

/** The questions in the order this attempt shows them; the quiz's own order before one starts. */
const questions = computed(() => {
  const all = quiz.value?.questions ?? []
  const order = state.value?.order
  if (!order?.length) return all
  const byId = new Map(all.map((q) => [q.id, q]))
  const named = new Set(order)
  return [
    ...order.flatMap((id) => byId.get(id) ?? []),
    ...all.filter((q) => !named.has(q.id)),
  ]
})
const optionsOf = (id: number) => state.value?.options?.[id]
const byQ = computed<Record<number, Given>>(() =>
  Object.fromEntries(
    (state.value?.answers ?? []).map((f) => [f.questionId, f]),
  ),
)
const answered = computed(
  () => (state.value?.answers ?? []).filter((f) => !f.skipped).length,
)
const resumable = computed(() => !!held.value && state.value?.status === "open")

const plural = (n: number, word: string) =>
  `${n} ${n === 1 ? word : `${word}s`}`
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

/** Seconds as words: "30 seconds", "1 minute 30 seconds", "1 hour". */
function duration(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return [
    h ? plural(h, "hour") : "",
    m ? plural(m, "minute") : "",
    s ? plural(s, "second") : "",
  ]
    .filter(Boolean)
    .join(" ")
}
/** Milliseconds as a clock face: "4:05", "1:02:09". */
function clockFace(ms: number) {
  const total = Math.ceil(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, "0")
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`
}

onMounted(async () => {
  try {
    quiz.value = await takeApi.quiz(code, countVisit(code))
    document.title = `${quiz.value.quiz.title} · QuizApp`
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
    stage.value = "missing"
    return
  }
  if (held.value) {
    try {
      state.value = await takeApi.state(held.value)
      setDeadline(state.value.timeLeft)
    } catch (e) {
      // A 404 is an attempt the server no longer knows; anything else (offline)
      // keeps it, so the next load can still resume.
      if (e instanceof ApiError && e.status === 404) {
        dropAttempt(code)
        held.value = null
      }
    }
  }
  const s = state.value
  if (s?.status === "finished") {
    markDone(code)
    stage.value = "done"
  } else if (!s && !allowRetake.value && wasDone(code)) {
    stage.value = "taken"
  } else if (s?.status === "open" && s.timeLeft === 0) {
    // The overall limit ran out while the page was closed.
    await finish(true)
    if (stage.value === "loading") stage.value = "intro"
  } else {
    stage.value = "intro"
  }
})

// ---- the intro: what to expect -----------------------------------------------------
type Fact = { icon: string; text: string }
const facts = computed<Fact[]>(() => {
  const i = info.value
  if (!i) return []
  const out: Fact[] = []
  if (i.timeMode === "question" && i.timeLimit)
    out.push({
      icon: "take:timer",
      text: `Each question has ${duration(i.timeLimit)}. At zero the quiz moves on, and a passed question cannot be opened again.`,
    })
  if (i.timeMode === "overall" && i.timeLimit)
    out.push({
      icon: "take:timer",
      text: `The whole quiz has ${duration(i.timeLimit)}, from the moment it starts. At zero it finishes on its own.`,
    })
  if (!i.allowRetake)
    out.push({
      icon: "take:lock",
      text: "Each browser gets one attempt at this quiz.",
    })
  if (!i.showResults)
    out.push({
      icon: "take:hourglass",
      text: "The score and the answers come later, when the quiz maker releases them.",
    })
  if (!i.aiEssay && quiz.value?.questions.some((q) => q.kind === "essay"))
    out.push({
      icon: "qa:edit",
      text: "The quiz maker scores the essays by hand, so their points come later.",
    })
  return out
})
const aiNotice = computed(() =>
  questions.value.some(
    (q) =>
      (q.kind === "identify" && aiCheck.value) ||
      (q.kind === "essay" && aiEssay.value),
  ),
)
const resumeNote = computed(() => {
  if (!resumable.value || !state.value) return ""
  const so = `${state.value.name}, you answered ${answered.value} of ${questions.value.length}.`
  const clock =
    timeMode.value === "overall" && left.value != null
      ? ` ${clockFace(left.value)} is left on the clock, which kept running while the quiz was closed.`
      : ""
  const next = allowRetake.value
    ? " Continue where you left off, or start over."
    : " Continue where you left off."
  return so + clock + next
})

// ---- the name, and starting -------------------------------------------------------
const nameDialog = ref<HTMLDialogElement>()
const nameInput = ref("")
/** Optional, under the name: the class section ("7 Sampaguita"). */
const sectionInput = ref("")
const startError = ref("")
const starting = ref(false)

function begin() {
  if (resumable.value) {
    const list = questions.value
    // Per question, the clock's own record says which question was on
    // screen: those before it were passed and stay passed.
    const pace = timeMode.value === "question" ? readPace(code) : null
    const mine = pace && pace.attempt === held.value?.attempt ? pace : null
    const from = mine
      ? Math.max(
          0,
          list.findIndex((q) => q.id === mine.q),
        )
      : 0
    const open = list.findIndex((q, i) => i >= from && !byQ.value[q.id])
    const i = open === -1 ? list.length - 1 : open
    enter(i, mine && list[i]?.id === mine.q ? mine.at : undefined)
    stage.value = "question"
    return
  }
  startError.value = ""
  nameDialog.value?.showModal()
}

async function start() {
  const name = nameInput.value.trim()
  const section = sectionInput.value.trim()
  if (!name) {
    startError.value = "Enter your name to start."
    return
  }
  starting.value = true
  startError.value = ""
  try {
    const h = await takeApi.start(code, name, section, countVisit(code))
    held.value = { attempt: h.attempt, token: h.token }
    holdAttempt(code, held.value)
    state.value = {
      status: "open",
      name,
      section: section || null,
      held: !(info.value?.showResults ?? true),
      score: 0,
      total: quiz.value!.quiz.points,
      rating: null,
      answers: [],
      order: h.order,
      options: h.options,
      timeLeft: h.timeLeft,
      notify: null,
    }
    setDeadline(h.timeLeft)
    nameDialog.value?.close()
    enter(0)
    stage.value = "question"
  } catch (e) {
    startError.value = e instanceof Error ? e.message : String(e)
  } finally {
    starting.value = false
  }
}

/** A fresh attempt; the old one stays with the quiz maker as it was. */
function startOver() {
  // The name and section fields start empty: on a shared classroom phone
  // the next attempt is often another student's.
  nameInput.value = ""
  sectionInput.value = ""
  dropAttempt(code)
  dropPace(code)
  held.value = null
  state.value = null
  deadline.value = null
  expired.value = false
  timedOut.value = false
  lapsed.value = null
  stage.value = "intro"
  begin()
}

// ---- one question at a time ---------------------------------------------------------
const at = ref(0)
const current = computed(() => questions.value[at.value])
const isLast = computed(() => at.value === questions.value.length - 1)
const busy = ref(false)
const finishing = ref(false)
const answerError = ref("")

function go(i: number) {
  at.value = Math.max(0, Math.min(i, questions.value.length - 1))
  answerError.value = ""
}
watch(at, () => window.scrollTo({ top: 0 }))

/** Moves to a question and, per question, starts its clock (or resumes it from `startedAt`). */
function enter(i: number, startedAt?: number) {
  go(i)
  qStop.value = null
  const q = current.value
  if (timeMode.value !== "question" || !q || byQ.value[q.id]) {
    qStart.value = null
    return
  }
  // The tick runs every 250 ms; a clock started between ticks would read
  // more than its limit until the next one.
  now.value = Date.now()
  qStart.value = startedAt ?? now.value
  if (held.value)
    savePace(code, { attempt: held.value.attempt, q: q.id, at: qStart.value })
}

async function answer(given: { choice?: number; text?: string }) {
  const q = current.value
  if (!q || !held.value || !state.value || busy.value) return
  busy.value = true
  answerError.value = ""
  // An answer sent in time counts, however long the grading takes.
  if (timeMode.value === "question") qStop.value = Date.now()
  try {
    const f = await takeApi.answer(held.value, q.id, given)
    state.value.answers = [
      ...state.value.answers.filter((x) => x.questionId !== q.id),
      f,
    ]
    lapsed.value = null
  } catch (e) {
    qStop.value = null
    if (e instanceof ApiError && e.field === "time") {
      // The server's clock says the time is up: this one finishes too.
      deadline.value = Date.now()
    } else answerError.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

const confirm = ref<InstanceType<typeof ConfirmDialog>>()
async function next() {
  if (!isLast.value) {
    lapsed.value = null
    return enter(at.value + 1)
  }
  const open = questions.value.length - answered.value
  if (open > 0) {
    const ok = await confirm.value?.ask({
      title: `Finish with ${plural(open, "question")} not answered?`,
      text: "A question left unanswered scores zero.",
      action: "Finish",
    })
    if (!ok) return
  }
  await finish()
}

/** Ends the attempt; `auto` when a clock ran out, which happens once. */
async function finish(auto = false) {
  if (!held.value || finishing.value) return
  if (auto) {
    if (expired.value) return
    expired.value = true
  }
  finishing.value = true
  answerError.value = ""
  try {
    await takeApi.finish(held.value)
    endVisit(code)
    markDone(code)
    dropPace(code)
    timedOut.value = auto && timeMode.value === "overall"
    state.value = await takeApi.state(held.value)
    stage.value = "done"
    window.scrollTo({ top: 0 })
  } catch (e) {
    answerError.value = e instanceof Error ? e.message : String(e)
  } finally {
    finishing.value = false
  }
}

// ---- the clock ----------------------------------------------------------------------
const now = ref(Date.now())
/** Where an overall limit ends, on this browser's clock; set from the server's count of what is left. */
const deadline = ref<number | null>(null)
function setDeadline(ms: number | null) {
  now.value = Date.now()
  deadline.value = ms == null ? null : now.value + ms
}
/** When the question on screen appeared, and when its clock stopped (an answer went out). */
const qStart = ref<number | null>(null)
const qStop = ref<number | null>(null)
/** A clock ran out and the attempt is finishing or finished. */
const expired = ref(false)
/** The overall limit finished the attempt. */
const timedOut = ref(false)
/** The number of the question whose clock ran out, said on the next one. */
const lapsed = ref<number | null>(null)

const left = computed<number | null>(() => {
  if (timeMode.value === "overall" && deadline.value != null)
    return Math.max(0, deadline.value - now.value)
  if (timeMode.value === "question" && qStart.value != null)
    return Math.min(
      limitMs.value,
      Math.max(0, limitMs.value - ((qStop.value ?? now.value) - qStart.value)),
    )
  return null
})
const ticking = computed(
  () =>
    timeMode.value !== "none" &&
    (stage.value === "question" ||
      (stage.value === "intro" && resumable.value)),
)
let tick: ReturnType<typeof setInterval> | undefined
watch(
  ticking,
  (on) => {
    clearInterval(tick)
    tick = undefined
    if (!on) return
    now.value = Date.now()
    tick = setInterval(() => (now.value = Date.now()), 250)
  },
  { immediate: true },
)
onBeforeUnmount(() => clearInterval(tick))

// The calm warning: the last fifth of an overall limit, the last five
// seconds of a question's.
const warn = computed(
  () =>
    left.value != null &&
    (timeMode.value === "overall"
      ? left.value <= limitMs.value * 0.2
      : left.value <= 5000),
)
const lastMinute = computed(
  () =>
    timeMode.value === "overall" &&
    limitMs.value > 60_000 &&
    left.value != null &&
    left.value > 0 &&
    left.value <= 60_000,
)
// Screen readers hear the minutes as they change, not every second: the
// note is rewritten only when the clock crosses a whole minute, so it reads
// the exact time when a clock first shows ("1 minute 10 seconds left.") and
// whole minutes after that ("1 minute left.").
const minuteMark = computed(() =>
  stage.value === "question" && left.value != null && left.value > 0
    ? Math.ceil(left.value / 60_000)
    : 0,
)
const minuteNote = ref("")
watch(minuteMark, (m) => {
  const said = m && left.value ? duration(Math.round(left.value / 1000)) : ""
  minuteNote.value = said ? `${said} left.` : ""
})

// At zero: overall, the attempt finishes; per question, the next one comes
// up unanswered (the last one finishes). An answer still out is waited for.
watch([left, busy, finishing], () => {
  if (left.value !== 0 || busy.value || finishing.value) return
  if (stage.value !== "question") return
  if (timeMode.value === "overall") return void finish(true)
  const q = current.value
  if (!q || byQ.value[q.id]) return
  if (isLast.value) return void finish(true)
  const n = at.value + 1
  enter(at.value + 1)
  lapsed.value = n
})

// ---- the score ----------------------------------------------------------------------
const graded = computed(() =>
  (state.value?.answers ?? []).flatMap((f) => (f.held ? [] : [f])),
)
const score = computed(() => state.value?.score ?? 0)
const pct = computed(() =>
  state.value && state.value.total ? score.value / state.value.total : 0,
)
const headline = computed(() =>
  pct.value >= 0.75
    ? "Well done"
    : pct.value >= 0.5
      ? "Good work"
      : "Quiz finished",
)
// The design's green number and party popper are for a passing score; a low
// one is stated plainly, in the text color, with a note instead.
const passed = computed(() => pct.value >= 0.5)
const right = computed(() => graded.value.filter((f) => f.correct).length)
const skipped = computed(() => graded.value.filter((f) => f.skipped).length)
const anyAi = computed(() => graded.value.some((f) => f.byAi))
const waiting = computed(() => graded.value.filter((f) => f.pending).length)

// The design's five faces: Material's sentiment icons, saddest first.
const FACES = [
  { label: "Not at all", icon: "face-1" },
  { label: "Not much", icon: "face-2" },
  { label: "It was okay", icon: "face-3" },
  { label: "I liked it", icon: "face-4" },
  { label: "I loved it", icon: "face-5" },
] as const
const rateError = ref("")
async function rate(n: number) {
  if (!held.value || !state.value) return
  const before = state.value.rating
  state.value.rating = n
  rateError.value = ""
  try {
    await takeApi.finish(held.value, n)
  } catch (e) {
    state.value.rating = before
    rateError.value = e instanceof Error ? e.message : String(e)
  }
}

// ---- held results: the email to tell when they are out -----------------------------
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/
const notifyInput = ref("")
const notifyError = ref("")
const notifying = ref(false)
const changingNotify = ref(false)
async function sendNotify() {
  const email = notifyInput.value.trim()
  if (!EMAIL.test(email)) {
    notifyError.value = "Enter an email address like name@example.com."
    return
  }
  if (!held.value || !state.value) return
  notifying.value = true
  notifyError.value = ""
  try {
    const r = await takeApi.notify(held.value, email)
    state.value.notify = r.email
    changingNotify.value = false
  } catch (e) {
    notifyError.value = e instanceof Error ? e.message : String(e)
  } finally {
    notifying.value = false
  }
}
function changeNotify() {
  notifyInput.value = state.value?.notify ?? ""
  notifyError.value = ""
  changingNotify.value = true
}

// ---- the report flag, from the design: anonymous, read by the quiz maker ----------
const REASONS = [
  { value: "wrong", label: "An answer is wrong" },
  { value: "harmful", label: "It has harmful or unsafe content" },
  { value: "copied", label: "It copies someone else’s work" },
  { value: "other", label: "Something else" },
] as const
const reportDialog = ref<HTMLDialogElement>()
const reportReason = ref<string>("")
const reportNote = ref("")
const reportError = ref("")
const reporting = ref(false)
const reportSent = ref(false)
/** A report went from this page: the flag turns red and stays so. */
const reported = ref(false)
/** The question on screen when the flag was pressed; none from the other stages. */
const reportAbout = ref<{ id: number; n: number } | null>(null)
function openReport() {
  reportSent.value = false
  reportError.value = ""
  reportAbout.value =
    stage.value === "question" && current.value
      ? { id: current.value.id, n: at.value + 1 }
      : null
  reportDialog.value?.showModal()
}
async function sendReport() {
  if (!reportReason.value) {
    reportError.value = "Choose what is wrong with the quiz."
    return
  }
  reporting.value = true
  reportError.value = ""
  try {
    await takeApi.report(
      code,
      reportReason.value,
      reportNote.value,
      reportAbout.value?.id,
    )
    reportSent.value = true
    reported.value = true
    reportReason.value = ""
    reportNote.value = ""
  } catch (e) {
    reportError.value = e instanceof Error ? e.message : String(e)
  } finally {
    reporting.value = false
  }
}

const shareNote = ref("")
async function share() {
  const url = `${location.origin}/q/${code}`
  // A phone gets its own share sheet; a computer gets the link copied.
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    await navigator
      .share({ title: quiz.value?.quiz.title, url })
      .catch(() => {})
    return
  }
  try {
    await navigator.clipboard.writeText(url)
    shareNote.value = "Link copied."
  } catch {
    shareNote.value = url
  }
}

function openReview() {
  stage.value = "review"
  window.scrollTo({ top: 0 })
}

const initial = (name: string) => (name.trim()[0] ?? "?").toUpperCase()
</script>

<template>
  <div class="take">
    <div class="frame">
      <header class="bar">
        <RouterLink to="/" class="brand" aria-label="QuizApp"
          ><LogoMark :size="30"
        /></RouterLink>
        <span class="bar-title">{{
          quiz && stage !== "intro" ? quiz.quiz.title : "QuizApp"
        }}</span>
        <button
          v-if="quiz"
          type="button"
          class="flag"
          :data-reported="reported || undefined"
          :aria-label="
            reported ? 'Reported. Report this quiz again' : 'Report this quiz'
          "
          :title="reported ? 'Reported' : 'Report this quiz'"
          @click="openReport"
        >
          <Icon name="flag" :size="24" />
        </button>
      </header>

      <div v-if="stage === 'question' && current" class="progress">
        <div
          class="track"
          role="progressbar"
          aria-valuemin="1"
          :aria-valuemax="questions.length"
          :aria-valuenow="at + 1"
          :aria-label="`Question ${at + 1} of ${questions.length}`"
        >
          <div
            class="fill"
            :style="{ width: `${((at + 1) / questions.length) * 100}%` }"
          />
        </div>
        <span>{{ at + 1 }} / {{ questions.length }}</span>
        <span
          v-if="left != null"
          class="clock"
          role="timer"
          :data-warn="warn || undefined"
          :data-stopped="
            (timeMode === 'question' && qStop != null) || undefined
          "
          :aria-label="`Time left ${clockFace(left)}`"
        >
          <Iconify
            icon="take:timer"
            width="16"
            height="16"
            aria-hidden="true"
          />
          {{ clockFace(left) }}
        </span>
      </div>
      <span class="sr-only" aria-live="polite">{{ minuteNote }}</span>

      <main class="page">
        <p v-if="stage === 'loading'" class="state">Opening the quiz…</p>

        <section v-else-if="stage === 'missing'" class="card center">
          <span class="mark"><Icon name="info" :size="28" /></span>
          <h1>This quiz is not open</h1>
          <p class="muted">{{ loadError }}</p>
          <RouterLink to="/" btn>Go to QuizApp</RouterLink>
        </section>

        <!-- One attempt per browser, and this browser has had it. -->
        <template v-else-if="stage === 'taken' && quiz">
          <section class="card center">
            <span class="mark"
              ><Iconify icon="take:lock" width="28" height="28"
            /></span>
            <h1>Quiz already taken</h1>
            <p class="muted">
              This quiz allows one attempt from each browser, and this browser
              has used it. Ask the quiz maker if you need another attempt.
            </p>
          </section>
          <section class="card more">
            <div>
              <h2>Make a quiz of your own</h2>
              <p>
                Upload a module and the AI drafts a quiz from it, each question
                citing its page.
              </p>
              <RouterLink to="/register" btn="primary">Make a quiz</RouterLink>
            </div>
            <LogoMark :size="80" class="more-mark" />
          </section>
        </template>

        <!-- Intro: the quiz, who made it, and what to expect. -->
        <template v-else-if="stage === 'intro' && quiz">
          <section class="card center intro">
            <img
              v-if="quiz.quiz.image"
              class="cover"
              :src="quiz.quiz.image"
              alt=""
            />
            <span v-else-if="quiz.quiz.icon" class="mark own">
              <Iconify
                :icon="quiz.quiz.icon"
                width="40"
                height="40"
                aria-hidden="true"
              />
            </span>
            <span v-else class="mark"><Icon name="quiz" :size="30" /></span>
            <p class="kicker">Shared with you</p>
            <h1>{{ quiz.quiz.title }}</h1>
            <p v-if="quiz.quiz.description" class="desc">
              {{ quiz.quiz.description }}
            </p>
            <span class="count">
              <Icon name="quiz" :size="16" />
              {{ plural(quiz.quiz.questions, "question") }} ·
              {{ plural(quiz.quiz.points, "point") }}
            </span>
          </section>
          <section v-if="facts.length" class="card facts">
            <ul>
              <li v-for="f in facts" :key="f.text">
                <Iconify
                  :icon="f.icon"
                  width="18"
                  height="18"
                  aria-hidden="true"
                />
                <span>{{ f.text }}</span>
              </li>
            </ul>
          </section>
          <section v-if="quiz.quiz.by" class="card maker">
            <span class="avatar">{{ initial(quiz.quiz.by) }}</span>
            <span class="who">
              <strong>{{ quiz.quiz.by }}</strong>
              <small>Quiz maker</small>
            </span>
          </section>
          <section v-if="resumeNote" class="card notice">
            <Icon name="info" :size="18" />
            <p>{{ resumeNote }}</p>
          </section>
          <section v-if="aiNotice" class="card notice">
            <Icon name="sparkle" :size="18" />
            <p>
              Some answers are checked by AI, which can be wrong. The quiz maker
              sees every verdict and can change a score.
            </p>
          </section>
        </template>

        <template v-else-if="stage === 'question' && current">
          <section v-if="lastMinute" class="card notice soon">
            <Iconify icon="take:timer" width="18" height="18" />
            <p>One minute left. At zero the quiz finishes on its own.</p>
          </section>
          <section v-if="lapsed" class="card notice" role="status">
            <Iconify icon="take:timer" width="18" height="18" />
            <p>
              Time ran out on question {{ lapsed }}, so it counts as not
              answered.
            </p>
          </section>
          <TakeItem
            :question="current"
            :number="at + 1"
            :feedback="byQ[current.id]"
            :busy="busy"
            :options="optionsOf(current.id)"
            :held="state?.held"
            :show-hints="showHints"
            :ai-check="aiCheck"
            :ai-essay="aiEssay"
            @answer="answer"
          />
          <p v-if="answerError" class="error" role="alert">{{ answerError }}</p>
        </template>

        <!-- The score, from the design: the number, a rating, the review. -->
        <template v-else-if="stage === 'done' && state">
          <!-- Held: the answers are in, and the score waits for the quiz maker. -->
          <template v-if="state.held">
            <section class="card center score">
              <span class="mark"><Icon name="done" :size="30" /></span>
              <h1>Your answers are in</h1>
              <p class="muted">
                {{ answered }} of
                {{ plural(questions.length, "question") }} answered. The quiz
                maker releases the score and the answers later.
              </p>
              <p v-if="timedOut" class="muted">
                The time ran out, so the quiz finished on its own.
              </p>
            </section>
            <section class="card notify">
              <form
                v-if="!state.notify || changingNotify"
                novalidate
                @submit.prevent="sendNotify"
              >
                <h2>Get an email when the results are out</h2>
                <p class="muted">
                  One email goes to this address when the quiz maker releases
                  the results, and nothing else.
                </p>
                <label for="notify-email">Email address</label>
                <div class="notify-row">
                  <input
                    id="notify-email"
                    v-model="notifyInput"
                    field
                    @input="notifyError = ''"
                    type="email"
                    inputmode="email"
                    autocomplete="email"
                    maxlength="254"
                    placeholder="name@example.com"
                    :aria-invalid="!!notifyError || undefined"
                    :aria-describedby="notifyError ? 'notify-error' : undefined"
                  />
                  <button btn="primary" :disabled="notifying">
                    {{ notifying ? "Saving…" : "Notify me" }}
                  </button>
                </div>
                <p
                  v-if="notifyError"
                  id="notify-error"
                  class="error"
                  role="alert"
                >
                  {{ notifyError }}
                </p>
              </form>
              <div v-else class="notified" role="status">
                <Iconify
                  icon="take:mail-read"
                  width="22"
                  height="22"
                  aria-hidden="true"
                />
                <p>
                  An email goes to <strong>{{ state.notify }}</strong> when the
                  results are out.
                </p>
                <button type="button" btn="quiet" @click="changeNotify">
                  Change
                </button>
              </div>
            </section>
          </template>
          <template v-else>
            <section class="card center score">
              <span class="pop" aria-hidden="true">{{
                passed ? "🎉" : "📝"
              }}</span>
              <h1>{{ headline }}</h1>
              <p>You scored</p>
              <strong class="big" :data-passed="passed || undefined"
                >{{ fmt(score) }} / {{ fmt(state.total)
                }}<small> points</small></strong
              >
              <p class="muted">
                {{ right }} of {{ questions.length }} right{{
                  skipped ? `, ${skipped} not answered` : ""
                }}.
              </p>
              <p v-if="timedOut" class="muted">
                The time ran out, so the quiz finished on its own.
              </p>
            </section>
            <section v-if="waiting" class="card notice">
              <Icon name="edit" :size="18" />
              <p>
                {{ waiting === 1 ? "1 essay waits" : `${waiting} essays wait` }}
                for the quiz maker’s score, so the total can still go up.
              </p>
            </section>
            <section v-if="anyAi" class="card notice">
              <Icon name="sparkle" :size="18" />
              <p>
                The AI checked some of these answers. The quiz maker sees every
                verdict and can change a score.
              </p>
            </section>
          </template>
          <section class="card rate">
            <fieldset>
              <legend>How much did you enjoy this quiz?</legend>
              <div class="faces">
                <button
                  v-for="(face, i) in FACES"
                  :key="i"
                  type="button"
                  class="face"
                  :aria-pressed="state.rating === i + 1"
                  :aria-label="face.label"
                  :title="face.label"
                  @click="rate(i + 1)"
                >
                  <Icon :name="face.icon" :size="38" />
                </button>
              </div>
            </fieldset>
            <p v-if="state.rating" class="muted" role="status">Rating sent.</p>
            <p v-if="rateError" class="error" role="alert">{{ rateError }}</p>
          </section>
          <nav class="links" stack aria-label="After the quiz">
            <button
              v-if="!state.held"
              type="button"
              class="row"
              @click="openReview"
            >
              <Icon name="review" /> Review my answers
            </button>
            <button type="button" class="row" @click="share">
              <Icon name="link" /> Share the quiz link
            </button>
          </nav>
          <p v-if="shareNote" class="share-note" role="status">
            {{ shareNote }}
          </p>
          <section class="card more">
            <div>
              <h2>Make a quiz of your own</h2>
              <p>
                Upload a module and the AI drafts a quiz from it, each question
                citing its page.
              </p>
              <RouterLink to="/register" btn="primary">Make a quiz</RouterLink>
            </div>
            <LogoMark :size="80" class="more-mark" />
          </section>
          <button
            v-if="allowRetake"
            type="button"
            btn="quiet"
            class="again"
            @click="startOver"
          >
            Take the quiz again
          </button>
        </template>

        <!-- Every question with its feedback, skipped ones included. -->
        <template v-else-if="stage === 'review' && quiz && state">
          <div class="review-head">
            <button
              type="button"
              btn="quiet"
              class="back"
              @click="stage = 'done'"
            >
              <Icon name="back" :size="18" /> Your score
            </button>
            <strong>{{ fmt(score) }} / {{ fmt(state.total) }} points</strong>
          </div>
          <ol class="review">
            <li v-for="(q, i) in questions" :key="q.id">
              <TakeItem
                :question="q"
                :number="i + 1"
                :feedback="byQ[q.id]"
                :options="optionsOf(q.id)"
                :held="state.held"
                :ai-check="aiCheck"
                :ai-essay="aiEssay"
              />
            </li>
          </ol>
        </template>
      </main>

      <footer v-if="stage === 'intro' && quiz" class="foot">
        <button type="button" btn="primary" @click="begin">
          {{ resumable ? "Continue" : "Take the quiz" }}
        </button>
        <button
          v-if="resumable && allowRetake"
          type="button"
          btn="quiet"
          @click="startOver"
        >
          Start over
        </button>
        <p class="fine">
          QuizApp does not review or endorse the quizzes people share. Do not
          enter passwords or other private details.
        </p>
      </footer>
      <footer v-else-if="stage === 'question' && current" class="foot two">
        <!-- Per question, a passed question stays passed: no way back. -->
        <button
          v-if="timeMode !== 'question'"
          type="button"
          btn
          class="outline"
          :disabled="at === 0 || busy"
          @click="go(at - 1)"
        >
          Back
        </button>
        <!-- Filled once the question is answered: before that the answer is
             the main action, and passing the question is the quiet one. -->
        <button
          type="button"
          :btn="byQ[current.id] ? 'primary' : 'quiet'"
          class="pass"
          :disabled="busy || finishing"
          @click="next"
        >
          {{
            isLast
              ? finishing
                ? "Finishing…"
                : "Finish"
              : byQ[current.id]
                ? "Next"
                : "Skip"
          }}
        </button>
      </footer>
      <!-- The design's name prompt, on the browser's own <dialog>. -->
      <dialog ref="nameDialog" class="name-dialog" @close="startError = ''">
        <form @submit.prevent="start">
          <Icon name="info" :size="22" />
          <h2>This quiz needs your name</h2>
          <p>
            The quiz maker sees your name and section beside your answers. No
            account is needed.
          </p>
          <div class="field">
            <label for="taker-name">Name</label>
            <input
              id="taker-name"
              v-model="nameInput"
              field
              autofocus
              placeholder="Your name"
              autocomplete="name"
              maxlength="80"
              :aria-invalid="!!startError || undefined"
              :aria-describedby="startError ? 'name-error' : undefined"
            />
          </div>
          <!-- Optional, as the paper test's Section line: skipped if empty. -->
          <div class="field">
            <label for="taker-section">Section (optional)</label>
            <input
              id="taker-section"
              v-model="sectionInput"
              field
              placeholder="Such as 7 Sampaguita"
              autocomplete="off"
              maxlength="80"
            />
          </div>
          <p v-if="startError" id="name-error" class="error" role="alert">
            {{ startError }}
          </p>
          <div class="actions">
            <button
              type="button"
              btn
              class="outline"
              @click="nameDialog?.close()"
            >
              Cancel
            </button>
            <button btn="primary" :disabled="starting">
              {{ starting ? "Starting…" : "Continue" }}
            </button>
          </div>
        </form>
      </dialog>
      <!-- The report, from the flag. -->
      <dialog ref="reportDialog" class="name-dialog report-dialog">
        <form v-if="!reportSent" novalidate @submit.prevent="sendReport">
          <span class="flag-mark" aria-hidden="true"
            ><Icon name="flag" :size="22"
          /></span>
          <h2>Report this quiz</h2>
          <p>
            The quiz maker reads your report. It does not carry your name or
            your answers.
          </p>
          <p v-if="reportAbout" class="about">
            About question {{ reportAbout.n }}.
          </p>
          <fieldset class="reasons">
            <legend class="sr-only">What is wrong with the quiz?</legend>
            <label v-for="r in REASONS" :key="r.value">
              <input
                v-model="reportReason"
                type="radio"
                name="report-reason"
                :value="r.value"
              />
              {{ r.label }}
            </label>
          </fieldset>
          <label class="report-note">
            <span>Details, if you want to add any</span>
            <textarea v-model="reportNote" field rows="3" maxlength="600" />
          </label>
          <p v-if="reportError" class="error" role="alert">{{ reportError }}</p>
          <div class="actions">
            <button
              type="button"
              btn
              class="outline"
              @click="reportDialog?.close()"
            >
              Cancel
            </button>
            <button btn="primary" :disabled="reporting">
              {{ reporting ? "Sending…" : "Send report" }}
            </button>
          </div>
        </form>
        <div v-else class="sent" role="status">
          <span class="sent-mark" aria-hidden="true"
            ><Icon name="check" :size="24"
          /></span>
          <h2>Report sent</h2>
          <p>The quiz maker can read it now.</p>
          <div class="actions">
            <button type="button" btn="primary" @click="reportDialog?.close()">
              Close
            </button>
          </div>
        </div>
      </dialog>

      <ConfirmDialog ref="confirm" />
    </div>
  </div>
</template>

<style scoped>
/* The respondent's pages wear the student purple: every primary button,
     focus ring and accent below reads --accent, so one swap here recolors
     them. The teacher's brown stays reachable for the "Make a quiz" card. */
.take {
  --teacher: var(--accent);
  --teacher-ink: var(--accent-ink);
}
.frame {
  --accent: var(--student);
  --accent-ink: var(--student-ink);
  display: flex;
  flex-direction: column;
  width: min(100%, 600px);
  min-height: 100dvh;
  margin: 0 auto;

  /* A phone keeps the button at the thumb; a computer keeps it under the
     cards rather than at the window's foot, 230px below them. */
  @media (min-width: 768px) {
    min-height: 0;
  }
}

.bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
}
.brand {
  display: grid;
  color: var(--accent);
}
.flag {
  display: grid;
  place-items: center;
  flex: none;
  width: 44px;
  height: 44px;
  margin-left: auto;
  border: 0;
  border-radius: 50%;
  background: none;
  /* The muted ink, like the bar's other glyphs: red would be the one
     saturated color on the screen. Red once a report has gone. */
  color: var(--muted);
  cursor: pointer;

  &:hover {
    background: var(--hover);
  }
  &:focus-visible {
    outline: 2px solid var(--accent);
  }
  &[data-reported] {
    color: var(--bad);

    &:hover {
      background: color-mix(in srgb, var(--bad) 10%, transparent);
    }
  }
}
/* The report shares the name prompt's box but not its centering: the
   reasons and the field start at the content edge and the field runs the
   full width. Both classes are named so these rules outweigh the
   `.name-dialog` ones below, which come later at equal specificity. */
.name-dialog.report-dialog {
  text-align: left;

  form,
  .sent {
    align-items: stretch;
  }
  h2,
  > form > p,
  .sent p {
    text-align: center;
  }
  .about {
    color: var(--ink);
    font-weight: 600;
  }
  /* A reason's radio sits on the content edge, its hover pill outside it. */
  .reasons {
    margin: 4px -8px 0;
  }
  .reasons input {
    margin: 0;
  }
}
.flag-mark,
.sent-mark {
  display: grid;
  place-items: center;
  align-self: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--bad) 12%, var(--surface));
  color: var(--bad);
}
.sent {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sent-mark {
  background: var(--good-soft);
  color: var(--good);
}
.reasons {
  display: flex;
  flex-direction: column;
  margin: 4px 0 0;
  padding: 0;
  border: 0;

  label {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 0 8px;
    border-radius: var(--radius-lg);
    font-size: 15px;
    cursor: pointer;

    &:hover {
      background: var(--hover);
    }
  }
  input {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
  }
}
.report-note {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  font-weight: 600;

  textarea {
    min-height: 72px;
    padding: 8px 10px;
    resize: vertical;
    font-weight: 400;
  }
}
.big small {
  font-size: 18px;
  font-weight: 500;
}

.bar-title {
  min-width: 0;
  overflow: hidden;
  font: 500 19px var(--font-heading);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.progress {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px 8px;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}
.track {
  flex: 1;
  height: 8px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--accent) 22%, var(--surface));
}
.fill {
  height: 100%;
  border-radius: var(--radius-sm);
  background: var(--accent);
  transition: width 250ms var(--ease);
}
/* The clock: a small pill that turns to the warn color near the end and
   dims once an answer has stopped it. Never red, never pulsing. */
.clock {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  min-width: 4.6em;
  justify-content: center;
  padding: 3px 10px;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--accent) 10%, var(--surface));
  color: var(--accent);
  font-weight: 650;
  transition:
    background var(--fast) var(--ease),
    color var(--fast) var(--ease);

  &[data-warn] {
    background: color-mix(in srgb, var(--warn) 16%, var(--surface));
    color: color-mix(in srgb, var(--warn) 85%, var(--ink));
  }
  &[data-stopped] {
    opacity: 0.6;
  }
}

.page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  padding: 8px 16px 24px;
}
.state {
  padding: 64px 0;
  text-align: center;
  color: var(--muted);
}

.card {
  padding: 16px 18px;
  border-radius: var(--radius-xl);
  background: var(--surface);

  p {
    margin: 0;
  }
}
.center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 28px 20px;
  text-align: center;

  h1 {
    margin: 2px 0 4px;
    font-size: clamp(24px, 6vw, 30px);
    line-height: 1.2;
    letter-spacing: -0.01em;
  }
  [btn] {
    margin-top: 10px;
  }
}
.mark {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  margin-bottom: 8px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--accent-ink);
}
/* The quiz's own icon (any Iconify set, emoji sets in their own colors) on
   a soft tint rather than the solid accent, so a colored glyph reads. */
.mark.own {
  background: color-mix(in srgb, var(--accent) 12%, var(--surface));
  color: var(--accent);
}
/* A cover runs edge to edge across the top of the intro card. */
.intro {
  overflow: hidden;
}
.cover {
  display: block;
  width: calc(100% + 40px);
  max-width: none;
  aspect-ratio: 16 / 9;
  margin: -28px -20px 10px;
  object-fit: cover;
  background: var(--sunken);
}
.kicker {
  font-size: 15px;
}
.intro .desc {
  max-width: 46ch;
  margin: 0 0 8px;
  font-size: 15px;
  line-height: 1.5;
  white-space: pre-line;
  color: color-mix(in srgb, var(--ink) 75%, transparent);
}
.facts ul {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}
/* The rules share the notices' inset: an 18px glyph and a 10px gap, so the
   text of stacked cards starts on one edge. */
.facts li {
  display: flex;
  gap: 10px;
  font-size: 14px;
  line-height: 1.5;
  text-wrap: pretty;

  svg {
    flex: none;
    margin-top: 2px;
    color: var(--accent);
  }
}
.center .muted {
  text-wrap: pretty;
}
.notice.soon svg {
  color: color-mix(in srgb, var(--warn) 85%, var(--ink));
}

/* ---- held results: the email to tell ---- */
.notify {
  form {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  h2 {
    margin: 0;
    font-size: 17px;
  }
  label {
    margin-top: 4px;
    font-size: 13px;
    font-weight: 600;
  }
}
.notify-row {
  display: flex;
  gap: 8px;

  input {
    flex: 1;
    min-width: 0;
    min-height: 44px;
  }
  [btn] {
    flex: none;
    min-height: 44px;
    border-radius: var(--radius-full);
  }
}
.notified {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  line-height: 1.5;

  svg {
    flex: none;
    color: var(--good);
  }
  p {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  [btn] {
    flex: none;
    min-height: 44px;
  }
}
.count {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 12px;
  border-radius: var(--radius-full);
  background: var(--sunken);
  color: color-mix(in srgb, var(--ink) 70%, transparent);
  font-size: 14px;
}
.muted {
  font-size: 14px;
  color: var(--muted);
}

.maker {
  display: flex;
  align-items: center;
  gap: 14px;
}
.avatar {
  display: grid;
  place-items: center;
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  /* Purple for every maker: red and orange mean a wrong answer and a report here. */
  background: color-mix(in srgb, var(--accent) 16%, var(--surface));
  color: var(--accent);
  font-weight: 650;
}
.who {
  display: flex;
  flex-direction: column;

  small {
    font-size: 13px;
    color: var(--muted);
  }
}

.notice {
  display: flex;
  gap: 10px;
  font-size: 14px;
  line-height: 1.5;
  background: color-mix(in srgb, var(--accent) 6%, var(--surface));

  svg {
    flex: none;
    margin-top: 2px;
    color: var(--accent);
  }
}

.error {
  margin: 0;
  font-size: 14px;
  color: var(--bad);
}

/* ---- the bottom bar: the design's full-width buttons, kept in reach ---- */
.foot {
  position: sticky;
  bottom: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 24px 16px calc(12px + env(safe-area-inset-bottom));
  background: linear-gradient(to bottom, transparent, var(--bg) 16px);

  [btn] {
    width: 100%;
    border-radius: var(--radius-full);
  }
  &.two {
    flex-direction: row;
  }
}
.fine {
  margin: 2px 0 0;
  font-size: 12px;
  line-height: 1.4;
  text-align: center;
  color: var(--muted);
}
.outline {
  border-color: var(--accent);
  background: transparent;
  color: var(--accent);

  /* Disabled (the first question's Back): outline and text at 38% of the
     ink, Material's disabled level, in place of the global 60% opacity
     that left the purple outline reading heavier than the quiet Skip. */
  &:disabled {
    border-color: color-mix(in srgb, var(--ink) 38%, transparent);
    color: color-mix(in srgb, var(--ink) 38%, transparent);
    opacity: 1;
  }
}
/* Skip, as Material's text button: the accent on nothing. */
.pass[btn="quiet"] {
  color: var(--accent);
}

/* ---- the score ---- */
.score {
  gap: 2px;

  h1 {
    margin-top: 6px;
  }
}
.pop {
  font-size: 44px;
  line-height: 1;
}
.big {
  margin: 4px 0 6px;
  font: 650 44px/1.1 var(--font-heading);
  font-variant-numeric: tabular-nums;

  &[data-passed] {
    color: var(--good);
  }
}

.rate {
  text-align: center;

  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend {
    width: 100%;
    margin-bottom: 8px;
    font-size: 14px;
    font-weight: 650;
  }
  .muted {
    margin-top: 6px;
  }
}
.faces {
  display: flex;
  justify-content: center;
  gap: 6px;
}
.face {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--muted);
  cursor: pointer;

  &:hover {
    background: var(--hover);
    color: var(--ink);
  }
  &:focus-visible {
    outline: 2px solid var(--accent);
  }
  &[aria-pressed="true"] {
    background: color-mix(in srgb, var(--accent) 14%, var(--surface));
    color: var(--accent);
  }
}

.row {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 56px;
  padding: 0 18px;
  border: 0;
  border-radius: var(--radius-tile);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--hover);
  }
  &:focus-visible {
    outline: 2px solid var(--accent);
  }
}
.share-note {
  padding: 2px 12px 8px 50px;
  font-size: 13px;
  color: var(--muted);
  overflow-wrap: anywhere;
}

.more {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 20px;

  h2 {
    margin: 0 0 4px;
    font-size: 18px;
  }
  p {
    font-size: 14px;
    color: color-mix(in srgb, var(--ink) 70%, transparent);
  }
  [btn] {
    margin-top: 12px;
    min-height: 44px;
    border-radius: var(--radius-full);
    background: var(--teacher);
    border-color: var(--teacher);
    color: var(--teacher-ink);
  }
}
.more-mark {
  flex: none;
  color: var(--teacher);
}
.again {
  align-self: center;
}

/* ---- the review ---- */
.review-head {
  display: flex;
  align-items: center;
  justify-content: space-between;

  strong {
    font-variant-numeric: tabular-nums;
  }
}
.back {
  min-height: 44px;
  padding: 0 10px;
}
.review {
  display: flex;
  flex-direction: column;
  gap: 28px;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* ---- the name ---- */
.name-dialog {
  width: min(92vw, 380px);
  padding: 22px;
  border: 0;
  border-radius: var(--radius-xl);
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--shadow-md);
  text-align: center;

  &::backdrop {
    background: rgb(0 0 0 / 0.35);
  }
  form {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  h2 {
    margin: 0;
    font-size: 19px;
  }
  p {
    margin: 0;
    font-size: 14px;
    color: var(--muted);
  }
  .error {
    color: var(--bad);
  }
  /* A field with its label above, on the left edge of the centered form. */
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    margin-top: 4px;
    text-align: left;

    label {
      font-size: 13px;
      font-weight: 600;
    }
  }
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
  margin-top: 6px;

  [btn] {
    min-height: 44px;
    border-radius: var(--radius-full);
  }
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
