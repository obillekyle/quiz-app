import { ref, watch } from "vue"

/*
 * Light (the default, the look every screen was reviewed in), dark, or the
 * system's, from the settings page. Kept in this
 * browser; applied as `data-theme` on <html>, which the tokens read
 * (styles/tokens.css). Applied before the app mounts, so a dark page does not
 * flash light first.
 */
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

function apply() {
  const on =
    theme.value === "dark" || (theme.value === "system" && dark.matches)
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
