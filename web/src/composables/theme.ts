import { ref, watch } from "vue"

export type Theme = "system" | "light" | "dark"
const KEY = "qa_theme"
const dark = window.matchMedia("(prefers-color-scheme: dark)")

function stored(): Theme {
  try {
    const t = localStorage.getItem(KEY)
    return t === "system" || t === "dark" ? t : "light"
  } catch {
    return "light"
  }
}

const theme = ref<Theme>(stored())
/** Whether the dark tokens are on right now, for a color computed in script. */
export const isDark = ref(false)

function apply() {
  const on =
    theme.value === "dark" || (theme.value === "system" && dark.matches)
  isDark.value = on
  if (on) document.documentElement.setAttribute("data-theme", "dark")
  else document.documentElement.removeAttribute("data-theme")
}

watch(theme, (t) => {
  try {
    if (t === "light") localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, t)
  } catch {}
  apply()
})
dark.addEventListener("change", apply)

export function initTheme() {
  apply()
}

export const useTheme = () => theme
