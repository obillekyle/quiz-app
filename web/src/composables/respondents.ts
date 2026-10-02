/** A score under this share of the total is marked as low: 75%, the passing mark in Philippine schools. */
export const PASSING = 0.75
/** The same mark as the number a label shows ("Under 75% passing"). */
export const PASSING_PERCENT = Math.round(PASSING * 100)

/** True when a score is under the passing mark; a quiz with no points has no mark to be under. */
export const below = (score: number, total: number) =>
  !!total && score / total < PASSING

/** "87%", or nothing for a quiz with no points. */
export const percent = (score: number, total: number) =>
  total ? `${Math.round((score / total) * 100)}%` : ""

/** The letter on a respondent's avatar. */
export const initial = (name: string) => (name.trim()[0] ?? "?").toUpperCase()

const AVATARS = [
  "#6b276c",
  "#2f6fdb",
  "#5c3715",
  "#2e7d32",
  "#c62828",
  "#ef6c00",
]
/** A respondent's color: the same one for the same name on every page. */
export const avatarColor = (name: string) =>
  AVATARS[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % AVATARS.length]

/** "today" as "Today", where a relative time starts a cell. */
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
