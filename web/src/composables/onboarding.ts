import { ref } from "vue"

/** The get-started tutorial: shown once per account in a browser, and again from the account menu. */
const open = ref(false)
const key = (userId: number) => `qa_onboarded:${userId}`

export function useOnboarding() {
  return {
    open,
    show: () => (open.value = true),
    /** Opens it the first time this account uses the app in this browser. */
    firstRun(userId: number) {
      try {
        if (!localStorage.getItem(key(userId))) open.value = true
      } catch {
        // No storage (a private window that refuses it): the tutorial is skipped rather than shown on every load.
      }
    },
    done(userId: number | undefined) {
      open.value = false
      try {
        if (userId != null) localStorage.setItem(key(userId), "1")
      } catch {
        // Nothing to remember it in; it closes all the same.
      }
    },
  }
}
