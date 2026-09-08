/**
 * The Web Crypto implementation (which runs on Cloudflare Workers) must be able to read
 * and write exactly what the node:crypto one in server/db.js produces, otherwise the keys
 * already stored in SQLite would be unreadable after the move to Postgres.
 */
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { decrypt, encrypt, fromBase64Url, importKey, toBase64Url } from '../shared/crypto.js'

const SECRET = 'a-test-secret-value'
let db, key

beforeAll(async () => {
  process.env.APP_SECRET = SECRET
  db = await import('../server/db.js')
  db.openDb(await mkdtemp(path.join(os.tmpdir(), 'immoba-crypto-')))
  key = await importKey(SECRET)
})

describe('base64url', () => {
  it('round-trips arbitrary bytes and emits no padding or unsafe characters', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = crypto.getRandomValues(new Uint8Array(n))
      const text = toBase64Url(bytes)
      expect(text).not.toMatch(/[+/=]/)
      expect([...fromBase64Url(text)]).toEqual([...bytes])
    }
  })
})

describe('Web Crypto AES-256-GCM', () => {
  it('round-trips, including accents and long values', async () => {
    for (const value of ['sk-ant-secret', 'clé_à_échapper « ñ »', 'x'.repeat(5000)]) {
      expect(await decrypt(await encrypt(value, key), key)).toBe(value)
    }
  })

  it('returns an empty string for empty input, like the Node side', async () => {
    expect(await encrypt('', key)).toBe('')
    expect(await decrypt('', key)).toBe('')
    expect(db.encrypt('')).toBe('')
    expect(db.decrypt('')).toBe('')
  })

  it('never produces the same ciphertext twice', async () => {
    expect(await encrypt('same', key)).not.toBe(await encrypt('same', key))
  })

  it('emits the same three-part shape as node:crypto', async () => {
    const mine = (await encrypt('value', key)).split('.')
    const theirs = db.encrypt('value').split('.')
    expect(mine).toHaveLength(3)
    expect(theirs).toHaveLength(3)
    expect(fromBase64Url(mine[0]).length).toBe(fromBase64Url(theirs[0]).length) // iv
    expect(fromBase64Url(mine[1]).length).toBe(fromBase64Url(theirs[1]).length) // tag
  })
})

describe('interoperability with the stored SQLite rows', () => {
  it('reads what node:crypto wrote', async () => {
    for (const value of ['demo-token', 'clé Inmovilla àéî', '123_244_ext']) {
      expect(await decrypt(db.encrypt(value), key)).toBe(value)
    }
  })

  it('writes what node:crypto can read back', async () => {
    for (const value of ['sk-ant-abc', 'MyContraseña']) {
      expect(db.decrypt(await encrypt(value, key))).toBe(value)
    }
  })

  it('rejects a tampered ciphertext instead of returning garbage', async () => {
    const blob = await encrypt('secret', key)
    const [iv, tag, data] = blob.split('.')
    const flipped = fromBase64Url(data)
    flipped[0] ^= 0xff
    await expect(decrypt(`${iv}.${tag}.${toBase64Url(flipped)}`, key)).rejects.toThrow()
    await expect(decrypt('nonsense', key)).rejects.toThrow()
  })

  it('refuses a wrong secret', async () => {
    const other = await importKey('another-secret')
    await expect(decrypt(await encrypt('secret', key), other)).rejects.toThrow()
  })
})
