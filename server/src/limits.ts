/*
 * Rate limits, kept in memory: enough to stop one sender from spending what
 * the whole app shares (the AI's daily quota, the mailbox's daily sends, the
 * password check's CPU). They reset when the server restarts and are counted
 * per process, which is one process here.
 */

/**
 * Who a request comes from. Deployed, Cloudflare sets `cf-connecting-ip` to
 * the sender's address; without it, the last `x-forwarded-for` entry is the
 * one the nearest proxy appended. The first entry is whatever the sender
 * typed, so a limit keyed on it could be walked around with a header.
 */
export const addressOf = (c: { req: { header(name: string): string | undefined } }) =>
  c.req.header('cf-connecting-ip')?.trim() || c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim() || 'local'

/** True, and counted, when `who` has done this fewer than `max` times in the window (an hour by default). */
export function within(log: Map<string, number[]>, who: string, max: number, now = Date.now(), windowMs = 3600_000) {
  const recent = (log.get(who) ?? []).filter((t) => now - t < windowMs)
  if (recent.length >= max) return false
  log.set(who, [...recent, now])
  return true
}
