import { computed, effectScope, watch } from "vue"
import { useAuth } from "./auth"
import { useFetch } from "./fetch"

/** A quiz's Settings page, as every reader of a quiz gets it. */
export type QuizSettings = {
  description: string | null
  /** An Iconify id, such as "fluent-emoji-flat:test-tube". */
  icon: string | null
  /** The cover's address, shown instead of the icon. */
  image: string | null
  shuffleQuestions: boolean
  shuffleOptions: boolean
  timeMode: "none" | "question" | "overall"
  /** Seconds: for each question, or for the whole quiz. Null with no limit. */
  timeLimit: number | null
  /** A second attempt from the same browser. */
  allowRetake: boolean
  /** Off: score and answers stay hidden until released. */
  showResults: boolean
  resultsReleasedAt: number | null
  /** Identification answers checked by the AI beyond an exact match. */
  aiCheck: boolean
  /** Essays scored by the AI; off, they wait for the maker's score. */
  aiEssay: boolean
}

/** A quiz as the home list and the sidebar show it. */
export type QuizSummary = {
  id: number
  title: string
  language: "en" | "fil"
  status: "draft" | "published"
  archived: boolean
  shareCode: string
  questions: number
  createdAt: number
  updatedAt: number
} & QuizSettings

function create() {
  const list = useFetch<{ quizzes: QuizSummary[] }>("/quizzes")
  // A different person signing in on this tab gets their own list, not the last one's.
  const { userdata } = useAuth()
  watch(
    () => userdata.value?.id,
    (id, before) => {
      if (id && id !== before) list.refresh()
    },
  )
  return { ...list, quizzes: computed(() => list.data.value?.quizzes ?? []) }
}

let shared: ReturnType<typeof create> | undefined

/**
 * The signed-in user's quizzes, fetched once and shared: the sidebar's recent
 * list and the home page read the same request. It lives in its own effect
 * scope, so it outlasts whichever component asked first.
 */
export function useQuizzes() {
  shared ??= effectScope(true).run(create)!
  return shared
}

/** The card colors from the QuizApp design, one per quiz, steady across visits. */
const COLORS = [
  "#6b276c",
  "#2f6fdb",
  "#c62828",
  "#ef6c00",
  "#2e7d32",
  "#5c3715",
]
export const quizColor = (id: number) => COLORS[(id - 1) % COLORS.length]!

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" })

/** "today", "yesterday", "3 days ago", "2 weeks ago", from Unix seconds. */
export function edited(seconds: number) {
  const days = Math.round((seconds * 1000 - Date.now()) / 86_400_000)
  if (days === 0) return "today"
  if (days > -14) return relative.format(days, "day")
  if (days > -60) return relative.format(Math.round(days / 7), "week")
  return relative.format(Math.round(days / 30), "month")
}

// ---- one quiz, as the builder edits it ----------------------------------------

export const KINDS = ["choice", "truefalse", "identify", "essay"] as const
export type Kind = (typeof KINDS)[number]
export const KIND_LABEL: Record<Kind, string> = {
  choice: "Multiple choice",
  truefalse: "True or false",
  identify: "Identification",
  essay: "Essay",
}

export const BLOOM = [
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
] as const
export type Bloom = (typeof BLOOM)[number]

export type Question = {
  /** Absent on a question added in the builder and not saved yet. */
  id?: number
  kind: Kind
  prompt: string
  choices: { text: string; why: string }[]
  answer: number | null
  accepted: string[]
  rubric: string | null
  points: number
  explain: string
  topic: string
  bloom: Bloom
  page: number | null
  quote: string | null
  /** found, missing (not in the file), photo (check by eye), none (no material). */
  check?: "found" | "missing" | "photo" | "none"
  /** The file the quote was found in. */
  file?: string | null
  /** An illustration: a stored file's name, what it shows, and its credit. */
  image?: string | null
  imageAlt?: string | null
  imageCredit?: {
    from: "upload" | "module" | "wikimedia"
    text: string
    url: string | null
  } | null
}

export type Message = {
  id: number
  role: "user" | "ai"
  text: string
  meta: {
    files?: string[]
    model?: string
    ms?: number
    ops?: string[]
    questions?: number
    found?: number
  } | null
  createdAt: number
}

export type Source = {
  id: number
  name: string
  mime: string
  size: number
  pages: number | null
  /** reading: the server is still reading it; failed: it could not be read. */
  status: "reading" | "ready" | "failed"
  /** How it was read: its text layer, the AI (photos, scans), or both. */
  method: "text" | "ai" | "mixed" | null
  error: string | null
}

export type FullQuiz = {
  quiz: {
    id: number
    title: string
    language: "en" | "fil"
    status: "draft" | "published"
    archived: boolean
    shareCode: string
    prompt: string | null
    createdAt: number
    updatedAt: number
  } & QuizSettings
  questions: Question[]
  sources: Source[]
  messages: Message[]
}

/** A new question of a kind, ready to edit. */
export function blankQuestion(kind: Kind): Question {
  return {
    kind,
    prompt: "",
    choices:
      kind === "choice"
        ? [0, 1, 2, 3].map(() => ({ text: "", why: "" }))
        : kind === "truefalse"
          ? [
              { text: "True", why: "" },
              { text: "False", why: "" },
            ]
          : [],
    answer: kind === "choice" || kind === "truefalse" ? 0 : null,
    accepted: [],
    rubric: kind === "essay" ? "" : null,
    points: kind === "essay" ? 5 : 1,
    explain: "",
    topic: "",
    bloom: "remember",
    page: null,
    quote: null,
  }
}

/** Tells the list to fetch again (after a quiz is created, saved or deleted). */
export function refreshQuizzes() {
  shared?.refresh()
}

const count = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

/**
 * What releasing a quiz's held results does, for the confirmation: who is
 * emailed, and the essays still without a score.
 */
export function releaseText(waiting: number, pending: number) {
  const told = waiting
    ? `${count(waiting, "person", "people")} who left an email ${waiting === 1 ? "gets" : "get"} one with the link.`
    : "Nobody has left an email, so no email goes out."
  const unscored = pending
    ? ` ${count(pending, "essay still waits", "essays still wait")} for your score and ${pending === 1 ? "counts" : "count"} as 0 until you give one.`
    : ""
  return `Respondents can see their scores and the answers from now on. ${told}${unscored}`
}

/** "3 people were emailed", after a release. */
export function toldText(told: number, failed = 0) {
  const sent = told
    ? `${count(told, "person was", "people were")} emailed.`
    : "Nobody was waiting for an email."
  return failed
    ? `${sent} ${count(failed, "email", "emails")} could not be sent; releasing again retries ${failed === 1 ? "it" : "them"}.`
    : sent
}

/** Where a quiz's results stand, from its overview. */
export type ResultsState = {
  /** Respondents see neither their score nor the answers yet. */
  held: boolean
  releasedAt: number | null
  /** Finished respondents who left an email and have not been told. */
  waiting: number
  /** Essays waiting for the maker's score, and the response with the oldest. */
  pending: number
  pendingIn: number | null
}
