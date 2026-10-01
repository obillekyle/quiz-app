import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

/**
 * Password hashing with scrypt from `node:crypto`, which Bun and Node both
 * have, so the same hash verifies on either runtime.
 *
 * scrypt is deliberately slow and memory-hungry (N=16384, r=8: 16 MB per
 * hash), which is what makes guessing a leaked hash expensive. The parameters
 * are stored in the hash itself, so they can be raised later without
 * breaking the hashes already stored.
 */
const N = 16384
const R = 8
const P = 1
const KEYLEN = 64

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEYLEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  )
}

/** `scrypt$N$r$p$salt$hash`, salt and hash in base64. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await derive(password, salt, N, R, P)
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split('$')
  if (kind !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const key = await derive(password, Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p))
  // Compares every byte whatever the first mismatch, so the time taken says
  // nothing about how close a guess was.
  return key.length === expected.length && timingSafeEqual(key, expected)
}

/**
 * A hash of nothing in particular, verified when an email has no account, so
 * "no such account" takes as long as "wrong password" and the response time
 * does not reveal which emails are registered.
 */
export const DECOY_HASH = await hashPassword(randomBytes(16).toString('hex'))
