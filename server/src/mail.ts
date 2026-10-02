import nodemailer, { type Transporter } from 'nodemailer'

const user = () => (process.env.MAIL_USER ?? process.env.EMAIL_USER ?? '').trim()
// Google shows the app password in four groups of four; the spaces are not part of it.
const pass = () => (process.env.MAIL_APP_PASSWORD ?? process.env.EMAIL_PASSWORD ?? '').replace(/\s+/g, '')

export const mailConfigured = () => !!(user() && pass())
export const mailToLog = () => !mailConfigured() && process.env.NODE_ENV !== 'production'

let transport: Transporter | null = null

export type Sent = 'mail' | 'log'

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)

export function resultsMail(m: { title: string; link: string; name: string }) {
  const lines = [
    `Hi ${m.name},`,
    '',
    `The results of "${m.title}" are out. Your score and the answers are on the quiz's page:`,
    '',
    m.link,
    '',
    'Open the link in the browser you took the quiz in: your result is kept there.',
    '',
    'This email went out because you asked to be told when the results were released. No other email follows.',
  ]
  return {
    subject: `Your results for "${m.title}" are out`,
    text: `${lines.join('\n')}\n`,
    html: `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#1a1a1a;line-height:1.5">
<p>Hi ${escape(m.name)},</p>
<p>The results of <strong>${escape(m.title)}</strong> are out. Your score and the answers are on the quiz's page:</p>
<p><a href="${escape(m.link)}" style="color:#5c3715;font-weight:600">${escape(m.link)}</a></p>
<p>Open the link in the browser you took the quiz in: your result is kept there.</p>
<p style="color:#555">This email went out because you asked to be told when the results were released. No other email follows.</p>
</div>`,
  }
}

/** Sends one message; answers how it went out. Throws when it could not go at all. */
export async function sendMail(m: { to: string; subject: string; text: string; html: string }): Promise<Sent> {
  if (!mailConfigured()) {
    if (!mailToLog()) throw new Error('mail is not configured')
    console.log(`\n[mail, not sent: MAIL_USER is not set] to ${m.to}\n${m.subject}\n${m.text}\n`)
    return 'log'
  }
  transport ??= nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: user(), pass: pass() },
  })
  await transport.sendMail({
    from: process.env.MAIL_FROM?.trim() || `QuizApp <${user()}>`,
    to: m.to,
    subject: m.subject,
    text: m.text,
    html: m.html,
  })
  return 'mail'
}
