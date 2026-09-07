import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { signToken, verifyToken } from '../server/auth.js'
import { ClientsStore, mergeClient, sanitizeClient } from '../server/clientsStore.js'
import { emptyClient, fullName, initials, matchesClient, validateClient, whatsappLink } from '../src/models/client.js'
import { applyRemoteChanges, pendingChanges, pickWinner } from '../src/sync/merge.js'

const base = (over = {}) => ({ ...emptyClient(), id: 'abcdef123456', name: 'Ana', updatedAt: 1000, createdAt: 1000, ...over })

describe('session tokens', () => {
  it('round trips and rejects tampering/expiry', () => {
    const { token } = signToken('1234', { now: 1_000_000, ttlMs: 60_000 })
    expect(verifyToken(token, { now: 1_000_500 })).toMatchObject({ agency: '1234' })
    expect(verifyToken(token, { now: 2_000_000 })).toBeNull()
    expect(verifyToken(token.slice(0, -2) + 'xx', { now: 1_000_500 })).toBeNull()
    expect(verifyToken('garbage')).toBeNull()
  })
})

describe('sanitizeClient', () => {
  it('rejects bad ids and trims/coerces fields', () => {
    expect(sanitizeClient({ id: 'x' })).toBeNull()
    const c = sanitizeClient({ id: 'abcdef123456', name: 42, budgetMax: '250000', zones: ['A', '', 3], deleted: 0, updatedAt: '5' }, 10_000)
    expect(c).toMatchObject({ name: '42', budgetMax: 250000, zones: ['A', '3'], deleted: false, updatedAt: 5, createdAt: 5 })
  })

  it('caps timestamps that are far in the future', () => {
    const c = sanitizeClient({ id: 'abcdef123456', updatedAt: 9e15 }, 1_000_000)
    expect(c.updatedAt).toBe(1_000_000 + 5 * 60_000)
  })
})

describe('merge rules', () => {
  it('newest write wins; delete wins ties (server and client agree)', () => {
    const older = base({ name: 'old', updatedAt: 1 })
    const newer = base({ name: 'new', updatedAt: 2 })
    const tomb = base({ deleted: true, updatedAt: 1 })
    for (const merge of [mergeClient, pickWinner]) {
      expect(merge(older, newer).name).toBe('new')
      expect(merge(newer, older).name).toBe('new')
      expect(merge(older, tomb).deleted).toBe(true)
      expect(merge(undefined, older)).toBe(older)
    }
  })

  it('applyRemoteChanges keeps newer dirty local edits and takes newer remote ones', () => {
    const local = [base({ id: 'aaaaaa111111', name: 'local-newer', updatedAt: 10, dirty: true }), base({ id: 'bbbbbb222222', name: 'local-older', updatedAt: 1 })]
    const remote = [base({ id: 'aaaaaa111111', name: 'remote-older', updatedAt: 5 }), base({ id: 'bbbbbb222222', name: 'remote-newer', updatedAt: 3 }), base({ id: 'cccccc333333', name: 'brand-new', updatedAt: 2 })]
    const { merged, replaced } = applyRemoteChanges(local, remote)
    const byId = Object.fromEntries(merged.map((c) => [c.id, c]))
    expect(byId.aaaaaa111111.name).toBe('local-newer')
    expect(byId.bbbbbb222222).toMatchObject({ name: 'remote-newer', dirty: false })
    expect(byId.cccccc333333.name).toBe('brand-new')
    expect(replaced.sort()).toEqual(['bbbbbb222222', 'cccccc333333'])
    expect(pendingChanges(merged).map((c) => c.id)).toEqual(['aaaaaa111111'])
  })
})

describe('ClientsStore', () => {
  it('isolates agencies, applies LWW, lists since, persists and compacts', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'alma-'))
    const file = path.join(dir, 'clients.json')
    const store = new ClientsStore(file)
    await store.load()
    const { accepted } = store.apply('1', [base({ updatedAt: 100 }), { id: 'bad' }], 1000)
    expect(accepted).toEqual(['abcdef123456'])
    store.apply('2', [base({ name: 'other agency', updatedAt: 100 })], 1000)
    store.apply('1', [base({ name: 'stale', updatedAt: 50 })], 1000)
    expect(store.list('1')[0].name).toBe('Ana')
    // `since` compares against the server-side timestamp (the `now` passed to apply), so
    // devices also learn about server-owned changes such as the Inmovilla forwarding state.
    expect(store.list('1', 1000)).toHaveLength(0)
    expect(store.list('1', 999)).toHaveLength(1)
    store.apply('1', [base({ deleted: true, updatedAt: 200 })], 1000)
    await store.save()
    const reloaded = new ClientsStore(file)
    await reloaded.load()
    expect(reloaded.list('1')[0].deleted).toBe(true)
    expect(reloaded.list('2')[0].name).toBe('other agency')
    reloaded.compact(10, 1_000_000)
    expect(reloaded.list('1')).toHaveLength(0)
    expect(reloaded.list('2')).toHaveLength(1)
    await reloaded.save()
    expect(JSON.parse(await readFile(file, 'utf8')).agencies['1']).toEqual({})
  })
})

describe('client model', () => {
  it('searches accent-insensitively across fields and phone digits', () => {
    const c = base({ name: 'José', surname: 'Núñez', phone: '+34 600 12 34 56', email: 'jose@ex.com', notes: 'Busca ático' })
    expect(matchesClient(c, 'jose nunez')).toBe(true)
    expect(matchesClient(c, '6001234')).toBe(true)
    expect(matchesClient(c, 'atico')).toBe(true)
    expect(matchesClient(c, 'ex.com')).toBe(true)
    expect(matchesClient(c, 'maria')).toBe(false)
    expect(matchesClient(c, '')).toBe(true)
  })

  it('validates required name, email format and budget order', () => {
    expect(validateClient(base({ name: '' }))).toHaveProperty('name')
    expect(validateClient(base({ email: 'nope' }))).toHaveProperty('email')
    expect(validateClient(base({ budgetMin: 200, budgetMax: 100 }))).toHaveProperty('budgetMax')
    expect(validateClient(base({ email: 'a@b.co' }))).toEqual({})
  })

  it('formats names and whatsapp links', () => {
    expect(fullName(base({ name: 'Ana', surname: 'Pérez' }))).toBe('Ana Pérez')
    expect(fullName(base({ name: '' }))).toBe('Sin nombre')
    expect(initials(base({ name: 'ana', surname: 'pérez' }))).toBe('AP')
    expect(whatsappLink('600 123 456')).toBe('https://wa.me/34600123456')
    expect(whatsappLink('')).toBe('')
  })
})
