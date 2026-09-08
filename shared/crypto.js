/**
 * AES-256-GCM over the Web Crypto API, so the same code runs on Node and on
 * Cloudflare Workers (which has no `node:crypto`).
 *
 * The stored format is deliberately identical to the one `server/db.js` writes with
 * `node:crypto`: three base64url parts, `iv.tag.ciphertext`. Blobs written by either
 * implementation are readable by the other, so the SQLite rows migrate to Postgres
 * as-is, with no re-encryption step.
 *
 * Web Crypto appends the 16-byte authentication tag to the ciphertext, whereas Node
 * exposes it separately; these helpers split and rejoin it to keep the formats equal.
 */
const IV_BYTES = 12
const TAG_BYTES = 16

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// ---- base64url without Buffer (absent on Workers) ----
export function toBase64Url(bytes) {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export function fromBase64Url(text) {
  const padded = String(text).replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/** Derives the AES key the same way the Node side does: sha256 of the secret. */
export async function importKey(secret) {
  if (!secret) throw new Error('APP_SECRET is required')
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(secret)))
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function encrypt(text, key) {
  if (!text) return ''
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: TAG_BYTES * 8 }, key, encoder.encode(String(text))))
  // Web Crypto returns ciphertext||tag; Node keeps them apart, so split to match its format.
  const data = sealed.slice(0, sealed.length - TAG_BYTES)
  const tag = sealed.slice(sealed.length - TAG_BYTES)
  return `${toBase64Url(iv)}.${toBase64Url(tag)}.${toBase64Url(data)}`
}

export async function decrypt(blob, key) {
  if (!blob) return ''
  const [ivPart, tagPart, dataPart] = String(blob).split('.')
  if (!ivPart || !tagPart || dataPart === undefined) throw new Error('Malformed ciphertext')
  const data = fromBase64Url(dataPart)
  const tag = fromBase64Url(tagPart)
  const sealed = new Uint8Array(data.length + tag.length)
  sealed.set(data)
  sealed.set(tag, data.length)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(ivPart), tagLength: TAG_BYTES * 8 }, key, sealed)
  return decoder.decode(plain)
}
