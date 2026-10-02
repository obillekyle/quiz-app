import { customRef } from "vue"

export function readCookie(name: string): string | null {
  const prefix = `${encodeURIComponent(name)}=`
  const hit = document.cookie.split("; ").find((c) => c.startsWith(prefix))
  return hit ? decodeURIComponent(hit.slice(prefix.length)) : null
}

export function useCookie(
  name: string,
  options: { days?: number; path?: string } = {},
) {
  const { days = 365, path = "/" } = options
  return customRef<string | null>((track, trigger) => ({
    get() {
      track()
      return readCookie(name)
    },
    set(value) {
      const key = encodeURIComponent(name)
      document.cookie =
        value === null
          ? `${key}=; Max-Age=0; Path=${path}; SameSite=Lax`
          : `${key}=${encodeURIComponent(value)}; Max-Age=${days * 86400}; Path=${path}; SameSite=Lax`
      trigger()
    },
  }))
}
