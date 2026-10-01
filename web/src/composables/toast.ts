import { readonly, ref } from "vue"

/**
 * A toast: one short line at the bottom of the screen for three seconds,
 * confirming something that happened with no other sign (an archive, a
 * copy, a save). One at a time; a new one replaces the one on screen.
 * Toast.vue, mounted once in App.vue, draws it.
 */
const current = ref<string | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined

export const activeToast = readonly(current)

export function toast(text: string) {
  clearTimeout(timer)
  current.value = text
  timer = setTimeout(() => (current.value = null), 3000)
}
