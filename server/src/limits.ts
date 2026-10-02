
export const addressOf = (c: { req: { header(name: string): string | undefined } }) =>
  c.req.header('cf-connecting-ip')?.trim() || c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim() || 'local'

/** True, and counted, when `who` has done this fewer than `max` times in the window (an hour by default). */
export function within(log: Map<string, number[]>, who: string, max: number, now = Date.now(), windowMs = 3600_000) {
  const recent = (log.get(who) ?? []).filter((t) => now - t < windowMs)
  if (recent.length >= max) return false
  log.set(who, [...recent, now])
  return true
}
