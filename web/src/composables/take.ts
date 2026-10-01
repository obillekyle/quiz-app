import { api } from "./api"
import type { Kind } from "./quizzes"

/*
 * The respondent's side of a shared quiz (`/q/:code`): the types the public
 * routes answer with, and the attempt this browser holds.
 */

/** A question as a respondent sees it before answering: no answer, no reasons, no quote. */
/** A picture's source, shown under it: a Commons picture names its author and license. */
export type Credit = {
  from: "upload" | "module" | "wikimedia"
  text: string
  url: string | null
}

export type PublicQuestion = {
  id: number
  kind: Kind
  prompt: string
  choices: string[]
  points: number
  topic: string | null
  page: number | null
  /** An illustration above the question, as /api/illustrations/file/<name>. */
  image?: string | null
  imageAlt?: string | null
  imageCredit?: Credit | null
}

export type TimeMode = "none" | "question" | "overall"

export type PublicQuiz = {
  quiz: {
    title: string
    language: string
    by: string | null
    questions: number
    points: number
    description: string | null
    /** An Iconify id, such as "fluent-emoji-flat:test-tube". */
    icon: string | null
    /** The cover image's address, when it has one. */
    image: string | null
    timeMode: TimeMode
    /** Seconds: for each question, or for the whole quiz. */
    timeLimit: number | null
    allowRetake: boolean
    /** False while the quiz maker holds the score and the answers back. */
    showResults: boolean
    /** False when the quiz maker turned the hints off: no "Show hint" on a question. */
    showHints: boolean
    aiCheck: boolean
    aiEssay: boolean
  }
  questions: PublicQuestion[]
}

/** What comes back once a question is answered, or, after finishing, skipped. */
export type Feedback = {
  questionId: number
  skipped: boolean
  held?: false
  correct: boolean
  score: number
  points: number
  verdict: string | null
  byAi: boolean
  /** An essay waiting for the quiz maker's score. */
  pending: boolean
  choice: number | null
  text: string | null
  /** The right option, for multiple choice and true or false. */
  answer: number | null
  accepted: string[]
  /** Why each option is right or wrong, in option order. */
  reasons: (string | null)[]
  explain: string | null
  quote: string | null
  page: number | null
}

/** An answer while the results are held: what was given, and nothing about how it scored. */
export type Saved = {
  questionId: number
  skipped: false
  held: true
  points: number
  choice: number | null
  text: string | null
}

export type Given = Feedback | Saved

/**
 * The order an attempt is shown in: question ids, and for a question whose
 * options are shuffled, the original option indices in the order shown. The
 * page sends original indices back, so grading never sees the shuffle.
 */
export type Layout = { order: number[]; options: Record<string, number[]> }

export type Attempt = Layout & {
  status: "open" | "finished"
  name: string
  /** The section typed under the name ("7 Sampaguita"), if any. */
  section: string | null
  /** True while the quiz maker holds the results: no score, no feedback. */
  held: boolean
  score: number | null
  total: number
  rating: number | null
  answers: Given[]
  /** Milliseconds left on an overall limit, as the server counts it. */
  timeLeft: number | null
  /** The address to tell when the results are released. */
  notify: string | null
}

/** An attempt this browser started: its id and the token that proves it. */
export type Held = { attempt: number; token: string }

// localStorage can refuse (a private window in some browsers, storage full).
// An attempt that cannot be saved still works; it only cannot resume.
function read(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string | null) {
  try {
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {}
}

const attemptKey = (code: string) => `qa_attempt_${code}`

export function heldAttempt(code: string): Held | null {
  try {
    const v = JSON.parse(read(attemptKey(code)) ?? "null")
    return v && typeof v.attempt === "number" && typeof v.token === "string"
      ? v
      : null
  } catch {
    return null
  }
}
export const holdAttempt = (code: string, held: Held) =>
  write(attemptKey(code), JSON.stringify(held))
export const dropAttempt = (code: string) => write(attemptKey(code), null)

/*
 * A finished quiz, remembered apart from its attempt: on a quiz that allows
 * one attempt, a revisit shows that it was taken even when the attempt
 * itself is gone (deleted by the quiz maker, or its key cleared).
 */
const doneKey = (code: string) => `qa_done_${code}`
export const markDone = (code: string) => write(doneKey(code), "1")
export const wasDone = (code: string) => read(doneKey(code)) === "1"

/*
 * Where a per-question clock stands: the question on screen and when it
 * appeared. A reload resumes that question with the time it had left, and
 * questions passed before it stay passed, rather than a refresh restarting
 * the clock.
 */
export type Pace = { attempt: number; q: number; at: number }
const paceKey = (code: string) => `qa_pace_${code}`
export function readPace(code: string): Pace | null {
  try {
    const v = JSON.parse(read(paceKey(code)) ?? "null")
    return v &&
      typeof v.attempt === "number" &&
      typeof v.q === "number" &&
      typeof v.at === "number"
      ? v
      : null
  } catch {
    return null
  }
}
export const savePace = (code: string, pace: Pace) =>
  write(paceKey(code), JSON.stringify(pace))
export const dropPace = (code: string) => write(paceKey(code), null)

/*
 * Views count visits. A visit is counted once, when the page opens (or, for a
 * retake, when the attempt starts), and ends when its attempt is finished;
 * a refresh in between counts nothing. So a quiz's views never fall below
 * its attempts, whether one person retakes it or a class shares one
 * computer.
 */
const visitKey = (code: string) => `qa_seen_${code}`
/** True when this visit has not been counted yet; marks it counted. */
export function countVisit(code: string) {
  const first = !read(visitKey(code))
  write(visitKey(code), "1")
  return first
}
/** The visit ends with its attempt; the next one counts again. */
export const endVisit = (code: string) => write(visitKey(code), null)

/** The public routes, with the attempt's token in a header rather than the address. */
export const takeApi = {
  quiz: (code: string, count: boolean) =>
    api<PublicQuiz>(`/q/${encodeURIComponent(code)}${count ? "" : "?seen=1"}`),
  /** `section` is optional on the page; an empty one is sent and stored as none. */
  start: (code: string, name: string, section: string, view: boolean) =>
    api<Held & Layout & { timeLeft: number | null }>(
      `/q/${encodeURIComponent(code)}/attempts`,
      { body: { name, section, view } },
    ),
  state: (h: Held) =>
    api<Attempt>(`/attempts/${h.attempt}`, {
      headers: { "x-attempt-token": h.token },
    }),
  answer: (
    h: Held,
    questionId: number,
    given: { choice?: number; text?: string },
  ) =>
    api<Given>(`/attempts/${h.attempt}/answers`, {
      body: { questionId, ...given },
      headers: { "x-attempt-token": h.token },
    }),
  /** A report from the flag; `questionId` is the question on screen, if one was. */
  report: (code: string, reason: string, note: string, questionId?: number) =>
    api<{ ok: true }>(`/q/${encodeURIComponent(code)}/reports`, {
      body:
        questionId == null ? { reason, note } : { reason, note, questionId },
    }),
  /** While the results are held, the reply carries no score. */
  finish: (h: Held, rating?: number) =>
    api<
      | { score: number; total: number; correct: number; answered: number }
      | { held: true; total: number; answered: number }
    >(`/attempts/${h.attempt}/finish`, {
      body: rating ? { rating } : {},
      headers: { "x-attempt-token": h.token },
    }),
  /** The address to email when the quiz maker releases the results. */
  notify: (h: Held, email: string) =>
    api<{ ok: true; email: string }>(`/attempts/${h.attempt}/notify`, {
      body: { email },
      headers: { "x-attempt-token": h.token },
    }),
}
