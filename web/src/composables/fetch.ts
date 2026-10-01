import {
  onScopeDispose,
  ref,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from "vue"
import { api, ApiError } from "./api"

/**
 * Reads JSON from the server into refs, and reads it again when the path
 * changes. A path of null waits: nothing is fetched until it has one.
 *
 *     const { data, error, loading, refresh } = useFetch<{ quizzes: Quiz[] }>('/quizzes')
 *     const quiz = useFetch(() => `/quizzes/${route.params.id}`)
 *
 * A reply that arrives after a newer request was sent is dropped, so a quick
 * change of path never shows the older page's data.
 */
export function useFetch<T>(
  path: MaybeRefOrGetter<string | null>,
  options: { immediate?: boolean } = {},
) {
  const data = shallowRef<T | null>(null)
  const error = ref<ApiError | null>(null)
  const loading = ref(false)
  let latest = 0

  async function refresh() {
    const p = toValue(path)
    if (p === null) return
    const mine = ++latest
    loading.value = true
    error.value = null
    try {
      const result = await api<T>(p)
      if (mine === latest) data.value = result
    } catch (e) {
      if (mine === latest)
        error.value = e instanceof ApiError ? e : new ApiError(String(e), 0)
    } finally {
      if (mine === latest) loading.value = false
    }
  }

  const stop = watch(() => toValue(path), refresh, {
    immediate: options.immediate ?? true,
  })
  onScopeDispose(stop)

  return { data, error, loading, refresh }
}

/**
 * Wraps something that changes data (signing in, saving a quiz) with the
 * state a form needs: `pending` while it runs, `error` when it fails.
 *
 *     const save = useAction((title: string) => api('/quizzes', { body: { title } }))
 *     await save.run('Metals')   // resolves undefined if it failed; see save.error
 *
 * A second `run` while one is pending is ignored, so a double click submits once.
 */
export function useAction<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
) {
  const pending = ref(false)
  const error = ref<ApiError | null>(null)

  async function run(...args: A): Promise<R | undefined> {
    if (pending.value) return
    pending.value = true
    error.value = null
    try {
      return await fn(...args)
    } catch (e) {
      error.value = e instanceof ApiError ? e : new ApiError(String(e), 0)
      return undefined
    } finally {
      pending.value = false
    }
  }

  return { run, pending, error }
}
