import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let db, auth, accounts, server, base
beforeAll(async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'immoba-db-'))
  process.env.APP_SECRET = 'test-secret'
  db = await import('../server/db.js')
  auth = await import('../server/auth.js')
  accounts = await import('../server/accounts.js')
  db.openDb(dir)
  const app = express()
  app.use('/api/account', accounts.createAccountsRouter({
    verifyInmovillaKeys: async (c) => { if (c.restToken !== 'good') throw Object.assign(new Error('bad key'), { status: 401 }) },
    verifyAnthropicKey: async (k) => { if (!k.startsWith('sk-ant-')) throw Object.assign(new Error('bad anthropic key'), { status: 401 }) },
  }))
  await new Promise((r) => (server = app.listen(0, r)))
  base = `http://localhost:${server.address().port}/api/account`
})
afterAll(() => server?.close())
const call = async (p, init = {}, token) => {
  const r = await fetch(base + p, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } })
  return { status: r.status, body: await r.json() }
}

describe('db primitives', () => {
  it('encrypts, hashes and signs', () => {
    expect(db.decrypt(db.encrypt('secret token'))).toBe('secret token')
    expect(db.encrypt('a')).not.toBe(db.encrypt('a'))
    const h = db.hashPassword('hunter22')
    expect(db.verifyPassword('hunter22', h)).toBe(true)
    expect(db.verifyPassword('hunter23', h)).toBe(false)
  })
})

describe('accounts API', () => {
  let adminToken, agentToken, agentId
  it('needs setup, then creates the agency and admin', async () => {
    expect((await call('/status')).body.needsSetup).toBe(true)
    const r = await call('/signup', { method: 'POST', body: JSON.stringify({ agencyName: 'Demo', name: 'Ana', email: 'ana@demo.com', password: 'password1' }) })
    expect(r.status).toBe(201)
    expect(r.body.user.role).toBe('admin')
    expect(r.body.agency.hasKeys).toBe(false)
    adminToken = r.body.token
    expect((await call('/status')).body.needsSetup).toBe(false)
    expect((await call('/signup', { method: 'POST', body: JSON.stringify({ agencyName: 'X', email: 'ana@demo.com', password: 'password1' }) })).status).toBe(409)
  })
  it('logs in and rejects bad passwords', async () => {
    expect((await call('/login', { method: 'POST', body: JSON.stringify({ email: 'ana@demo.com', password: 'nope' }) })).status).toBe(401)
    const r = await call('/login', { method: 'POST', body: JSON.stringify({ email: 'ANA@demo.com', password: 'password1' }) })
    expect(r.status).toBe(200)
    expect(auth.verifySession(r.body.token).role).toBe('admin')
    expect(auth.verifySession(r.body.token + 'x')).toBeNull()
  })
  it('lets only admins set keys, verified against Inmovilla, and keeps them server side', async () => {
    const bad = await call('/agency', { method: 'PUT', body: JSON.stringify({ numagencia: '1234', apiwebPassword: 'demo', restToken: 'wrong' }) }, adminToken)
    expect(bad.status).toBe(401)
    const ok = await call('/agency', { method: 'PUT', body: JSON.stringify({ numagencia: '1234', apiwebPassword: 'demo', restToken: 'good', idioma: 4 }) }, adminToken)
    expect(ok.status).toBe(200)
    expect(ok.body.agency).toMatchObject({ hasKeys: true, numagencia: '1234', idioma: 4, hasAnthropic: false })
    expect(JSON.stringify(ok.body)).not.toContain('good')
    const creds = db.agencyCredentials(ok.body.agency.id)
    expect(creds).toMatchObject({ numagencia: '1234', password: 'demo', restToken: 'good', idioma: 4 })
    expect(db.getAgency(ok.body.agency.id).rest_token).not.toContain('good') // encrypted at rest
  })
  it('stores the Anthropic key encrypted, verified, admin only, and can remove it', async () => {
    const bad = await call('/agency', { method: 'PUT', body: JSON.stringify({ anthropicKey: 'nope' }) }, adminToken)
    expect(bad.status).toBe(401)
    const ok = await call('/agency', { method: 'PUT', body: JSON.stringify({ anthropicKey: 'sk-ant-secret' }) }, adminToken)
    expect(ok.status).toBe(200)
    expect(ok.body.agency).toMatchObject({ hasAnthropic: true, hasKeys: true })
    expect(JSON.stringify(ok.body)).not.toContain('sk-ant-secret')
    expect(db.agencyCredentials(ok.body.agency.id).anthropicKey).toBe('sk-ant-secret')
    expect(db.getAgency(ok.body.agency.id).anthropic_key).not.toContain('sk-ant')
    expect((await call('/me', {}, adminToken)).body.agency.hasAnthropic).toBe(true)
    const removed = await call('/agency', { method: 'PUT', body: JSON.stringify({ anthropicKey: null }) }, adminToken)
    expect(removed.body.agency.hasAnthropic).toBe(false)
    expect(db.agencyCredentials(ok.body.agency.id).restToken).toBe('good') // other keys untouched
  })
  it('locks writes by default and lets only an admin lift the lock', async () => {
    const agencyId = db.getUserByEmail('ana@demo.com').agency_id
    expect(db.getAgency(agencyId).readOnly).toBe(true) // on for a brand new agency
    expect((await call('/agency', {}, adminToken)).body.agency.readOnly).toBe(true)
    const off = await call('/agency', { method: 'PUT', body: JSON.stringify({ readOnly: false }) }, adminToken)
    expect(off.body.agency).toMatchObject({ readOnly: false, hasKeys: true })
    expect(db.getAgency(agencyId).readOnly).toBe(false)
    expect((await call('/me', {}, adminToken)).body.agency.readOnly).toBe(false)
    // toggling the lock alone must not touch the stored keys
    expect(db.agencyCredentials(agencyId)).toMatchObject({ numagencia: '1234', password: 'demo', restToken: 'good' })
    expect(db.setAgencyReadOnly(agencyId, true).readOnly).toBe(true)
  })
  it('manages users with roles and protects the last admin', async () => {
    const created = await call('/users', { method: 'POST', body: JSON.stringify({ name: 'Bea', email: 'bea@demo.com', password: 'password2', role: 'agent' }) }, adminToken)
    expect(created.status).toBe(201)
    agentId = created.body.user.id
    const login = await call('/login', { method: 'POST', body: JSON.stringify({ email: 'bea@demo.com', password: 'password2' }) })
    agentToken = login.body.token
    expect((await call('/users', {}, agentToken)).status).toBe(403) // agents cannot manage users
    expect((await call('/agency', { method: 'PUT', body: JSON.stringify({ numagencia: '1' }) }, agentToken)).status).toBe(403)
    expect((await call('/agency', {}, agentToken)).body.agency.hasKeys).toBe(true) // but can see that keys exist
    expect((await call(`/users/${agentId}`, { method: 'PUT', body: JSON.stringify({ role: 'readonly' }) }, adminToken)).body.user.role).toBe('readonly')
    const me = await call('/me', {}, adminToken)
    expect((await call(`/users/${me.body.user.id}`, { method: 'PUT', body: JSON.stringify({ role: 'agent' }) }, adminToken)).status).toBe(400) // last admin
    expect((await call(`/users/${me.body.user.id}`, { method: 'DELETE' }, adminToken)).status).toBe(400)
    expect((await call(`/users/${agentId}`, { method: 'PUT', body: JSON.stringify({ active: false }) }, adminToken)).body.user.active).toBe(false)
    expect((await call('/me', {}, agentToken)).status).toBe(401) // deactivated sessions die at once
    expect((await call(`/users/${agentId}`, { method: 'DELETE' }, adminToken)).body.ok).toBe(true)
  })
  it('updates the own profile and password', async () => {
    expect((await call('/me', { method: 'PUT', body: JSON.stringify({ name: 'Ana G', currentPassword: 'wrong', newPassword: 'password9' }) }, adminToken)).status).toBe(403)
    const r = await call('/me', { method: 'PUT', body: JSON.stringify({ name: 'Ana G', currentPassword: 'password1', newPassword: 'password9' }) }, adminToken)
    expect(r.body.user.name).toBe('Ana G')
    expect((await call('/login', { method: 'POST', body: JSON.stringify({ email: 'ana@demo.com', password: 'password9' }) })).status).toBe(200)
  })
})
