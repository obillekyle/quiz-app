import { computed, readonly, ref } from "vue"
import { api } from "./api"

export type User = { id: number; name: string; email: string }

// Module-level, so every component that calls useAuth() shares one user.
const user = ref<User | null>(null)
let loading: Promise<void> | null = null

/** Asks the server once who is signed in. A server that cannot be reached counts as nobody. */
function ready(): Promise<void> {
  loading ??= api<{ user: User | null }>("/auth/me")
    .then((r) => {
      user.value = r.user
    })
    .catch(() => {
      user.value = null
    })
  return loading
}

export function useAuth() {
  return {
    userdata: readonly(user),
    isLoggedIn: computed(() => user.value !== null),
    ready,

    async login(email: string, password: string) {
      const r = await api<{ user: User }>("/auth/login", {
        body: { email, password },
      })
      user.value = r.user
    },

    sendCode(email: string) {
      return api<{ sent: true; via: "mail" | "log"; wait: number }>(
        "/auth/code",
        { body: { email } },
      )
    },

    /** Signs in with the code; `isNew` is true when this made the account. */
    async verifyCode(email: string, code: string) {
      const r = await api<{ user: User; isNew: boolean }>("/auth/code/verify", {
        body: { email, code },
      })
      user.value = r.user
      return r.isNew
    },

    async rename(name: string) {
      const r = await api<{ user: User }>("/auth/me", {
        method: "PATCH",
        body: { name },
      })
      user.value = r.user
    },

    async logout() {
      await api("/auth/logout", { method: "POST" })
      user.value = null
    },
  }
}
