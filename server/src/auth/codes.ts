import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import DB from 'bakery-orm'
import { HTTPException } from 'hono/http-exception'

const LIFE = 10 * 60
const GAP = 30
const PER_HOUR = 5
const TRIES = 5

const now = () => Math.floor(Date.now() / 1000)
const hash = (salt: string, code: string) => createHash('sha256').update(`${salt}:${code}`).digest('hex')

/** A new code for this address, which stops any earlier one from working. */
export async function issueCode(email: string): Promise<string> {
  const t = now()
  // A day-old row has done its job: the limits below look back an hour.
  await DB.Delete.from('codes').where('codes.sentAt', DB.lt(t - 86400)).run()

  const recent = await DB.from('codes').where('codes.email', email).and('codes.sentAt', DB.gt(t - 3600)).array()
  const last = recent.reduce((m: number, r: any) => Math.max(m, Number(r.sentAt)), 0)
  if (last && t - last < GAP)
    throw new HTTPException(429, { message: `A code was just sent. Ask for another in ${GAP - (t - last)} seconds.` })
  if (recent.length >= PER_HOUR)
    throw new HTTPException(429, {
      message: 'Five codes went to this address in the last hour. Try again later, or continue with Google.',
    })

  await DB.Update.table('codes').set({ usedAt: t }).where('codes.email', email).and('codes.usedAt', null).run()
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const salt = randomBytes(16).toString('hex')
  await DB.Insert.into('codes')
    .values({ email, salt, codeHash: hash(salt, code), sentAt: t, expiresAt: t + LIFE })
    .run()
  return code
}

/** Checks a code typed for this address; it works once. Throws a message for people when it does not. */
export async function checkCode(email: string, typed: string): Promise<void> {
  const code = typed.replace(/\D/g, '')
  if (code.length !== 6) throw new HTTPException(400, { message: 'Enter the 6 digits from the email.' })

  const t = now()
  const rows = await DB.from('codes').where('codes.email', email).and('codes.usedAt', null).orderBy('codes.id', 'DESC').array()
  const row: any = rows[0]
  if (!row || Number(row.expiresAt) <= t)
    throw new HTTPException(400, { message: 'That code no longer works. Ask for a new one.' })
  if (Number(row.tries) >= TRIES)
    throw new HTTPException(429, { message: 'Too many wrong tries for this code. Ask for a new one.' })

  const want = Buffer.from(String(row.codeHash), 'hex')
  const got = Buffer.from(hash(String(row.salt), code), 'hex')
  if (want.length !== got.length || !timingSafeEqual(want, got)) {
    await DB.Update.table('codes').set({ tries: Number(row.tries) + 1 }).where('codes.id', row.id).run()
    const left = TRIES - Number(row.tries) - 1
    throw new HTTPException(400, {
      message: left > 0
          ? `That code is not right. You have ${left} ${left === 1 ? 'try' : 'tries'} left.`
          : 'That code is not right. Ask for a new one.',
    })
  }
  await DB.Update.table('codes').set({ usedAt: t }).where('codes.id', row.id).run()
}

/** The email that carries a code: the digits in the subject, so a phone's notification shows them. */
export function codeMail(code: string) {
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`
  return {
    subject: `${spaced} is your QuizApp code`,
    text: `Your QuizApp sign-in code is ${spaced}.\n\nIt works for 10 minutes. If you did not ask for it, ignore this email: nobody can sign in without the code.\n`,
    html: `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#1a1a1a;line-height:1.5">
<p>Your QuizApp sign-in code is</p>
<p style="font-size:30px;font-weight:700;letter-spacing:4px;margin:8px 0 16px">${spaced}</p>
<p style="color:#555">It works for 10 minutes. If you did not ask for it, ignore this email: nobody can sign in without the code.</p>
</div>`,
  }
}
