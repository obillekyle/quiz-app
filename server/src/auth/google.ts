import { createHash, randomBytes } from 'node:crypto'
import type { Context } from 'hono'

/**
 * Google sign-in, done by the server (the OAuth "authorization code" flow
 * with PKCE). The browser is sent to Google and comes back to
 * `/api/auth/google/callback` with a one-time code; the server trades the
 * code for an ID token directly with Google. No Google token ever reaches a
 * page script, and the person ends up with the same session cookie an email
 * sign-in gives.
 */

const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN = 'https://oauth2.googleapis.com/token'

export const googleConfigured = () => !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET

/**
 * The address Google sends people back to. Must match one of the client's
 * authorized redirect URIs exactly. PUBLIC_URL in production (the server sits
 * behind a proxy, so the request's own address is not the public one); in
 * development the request's address, which is Vite's (localhost:3220): the
 * Vite proxy is set to keep the Host header (changeOrigin: false).
 */
export function redirectUri(c: Context) {
  const base = process.env.PUBLIC_URL ?? new URL(c.req.url).origin
  return `${base.replace(/\/$/, '')}/api/auth/google/callback`
}

const b64url = (buf: Buffer) => buf.toString('base64url')

/**
 * `state` ties Google's answer to this browser's request, so a link someone
 * else crafted cannot sign this browser in. The PKCE verifier proves the
 * server that started the sign-in is the one finishing it: Google gets only
 * its hash now, and the verifier itself with the code.
 */
export function startRequest() {
  const state = b64url(randomBytes(24))
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  return { state, verifier, challenge }
}

export function authorizeUrl(c: Context, state: string, challenge: string) {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(c),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  })
  return `${AUTHORIZE}?${q}`
}

export type GoogleProfile = { sub: string; email: string; emailVerified: boolean; name: string }

/**
 * Trades the code for tokens and reads who signed in from the ID token.
 *
 * The ID token's signature is not checked here, and need not be: it came
 * straight from Google's token endpoint over TLS in answer to this server's
 * own request, which OpenID Connect accepts in place of the signature
 * (Core 1.0, section 3.1.3.7). Its audience, issuer and expiry are still checked.
 */
export async function exchangeCode(c: Context, code: string, verifier: string): Promise<GoogleProfile> {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(c),
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  })
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string }
  if (!res.ok || !body.id_token) throw new Error(`Google refused the code: ${body.error_description ?? body.error ?? res.status}`)

  const payload = JSON.parse(Buffer.from(body.id_token.split('.')[1]!, 'base64url').toString('utf8'))
  if (payload.aud !== process.env.GOOGLE_CLIENT_ID) throw new Error('The ID token is for another client.')
  if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com')
    throw new Error('The ID token was not issued by Google.')
  if (Number(payload.exp) * 1000 < Date.now()) throw new Error('The ID token has expired.')

  return {
    sub: String(payload.sub),
    email: String(payload.email ?? '').toLowerCase(),
    emailVerified: payload.email_verified === true,
    name: String(payload.name ?? payload.given_name ?? '').slice(0, 80),
  }
}
