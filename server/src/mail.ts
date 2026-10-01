import nodemailer, { type Transporter } from 'nodemailer'

/*
 * Outgoing email: sign-in codes, and the note that a quiz's held-back
 * results are out. Sent from a Gmail account over SMTP
 * with an app password (Google Account, Security, App passwords), set as
 * MAIL_USER and MAIL_APP_PASSWORD in the server's .env.
 *
 * Without them, a development server prints each message to its log so the
 * flow can still be tried; a production server refuses instead, since a code
 * in a log file is a way into someone's account.
 */
// EMAIL_USER and EMAIL_PASSWORD are read as well: the .env was first filled
// with those names.
const user = () => (process.env.MAIL_USER ?? process.env.EMAIL_USER ?? '').trim()
// Google shows the app password in four groups of four; the spaces are not part of it.
const pass = () => (process.env.MAIL_APP_PASSWORD ?? process.env.EMAIL_PASSWORD ?? '').replace(/\s+/g, '')

export const mailConfigured = () => !!(user() && pass())
export const mailToLog = () => !mailConfigured() && process.env.NODE_ENV !== 'production'

let transport: Transporter | null = null

export type Sent = 'mail' | 'log'

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)

/**
 * The email a respondent asked for on a quiz whose results were held back:
 * the results are out, and where to see them. The result lives in the
 * browser the quiz was taken in (its attempt token is kept there), so the
 * message says to open the link in that browser.
 */
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
