import { readonly, ref } from "vue"

const current = ref<string | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined

export const activeToast = readonly(current)

export function toast(text: string) {
  clearTimeout(timer)
  current.value = text
  timer = setTimeout(() => (current.value = null), 3000)
}
