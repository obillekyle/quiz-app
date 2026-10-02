import {
  onScopeDispose,
  ref,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from "vue"
import { api, ApiError } from "./api"

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
