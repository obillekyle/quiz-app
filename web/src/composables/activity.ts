import { computed, effectScope } from "vue"
import { useFetch } from "./fetch"

/** Finished responses per day for every quiz over two weeks, oldest first, the last today. */
type Activity = { days: number; quizzes: Record<number, number[]> }

function create() {
  const tz = new Date().getTimezoneOffset()
  const res = useFetch<Activity>(`/responses/activity?days=14&tz=${tz}`)
  return {
    ...res,
    days: computed(() => res.data.value?.days ?? 14),
    of: (id: number) => res.data.value?.quizzes[id] ?? null,
  }
}

let shared: ReturnType<typeof create> | undefined

export function useActivity() {
  shared ??= effectScope(true).run(create)!
  return shared
}
