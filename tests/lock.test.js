/**
 * The agency-wide write lock: the relay must refuse every write while it is on,
 * whatever the user's role, and admins must not be able to lift it for someone else's agency.
 */
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let db, auth, server, base, adminToken, agentToken, agencyId

/** Minimal stand-in for the relay's guarded routes, using the real lock + role helpers. */
function buildRelay(db, auth) {
  const app = express()
  const locked = (req) => db.getAgency(req.user.agency_id)?.readOnly !== false
  const lockedResponse = (res) => res.status(403).json({ error: 'read only', code: 'locked' })
  app.use('/api/rest', auth.requireUser, express.raw({ type: () => true }), (req, res) => {
    const method = req.method.toUpperCase()
    // Mirrors server/index.js: HEAD is a GET without the body, so it is a read.
    const reads = method === 'GET' || method === 'HEAD'
    if (!reads && locked(req)) return lockedResponse(res)
    if (!reads && !auth.canWrite(req.user.role)) return res.status(403).json({ error: 'role', code: 'role' })
    if (method === 'DELETE' && !auth.canDelete(req.user.role)) return res.status(403).json({ error: 'role', code: 'role' })
    res.json({ relayed: method })
  })
  app.put('/api/photos', auth.requireUser, express.raw({ type: () => true }), (req, res) => {
    if (locked(req)) return lockedResponse(res)
    if (!auth.canWrite(req.user.role)) return res.status(403).json({ error: 'role', code: 'role' })
    res.json({ ok: true })
  })
  return app
}

beforeAll(async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'immoba-lock-'))
  process.env.APP_SECRET = 'test-secret'
  db = await import('../server/db.js')
  auth = await import('../server/auth.js')
  db.openDb(dir)
  const agency = db.createAgency({ name: 'Locked' })
  agencyId = agency.id
  db.setAgencyKeys(agencyId, { numagencia: '1234', apiwebPassword: 'demo', restToken: 'tok' })
  const admin = db.createUser({ agencyId, email: 'a@x.com', name: 'A', password: 'password1', role: 'admin' })
  const agent = db.createUser({ agencyId, email: 'b@x.com', name: 'B', password: 'password1', role: 'agent' })
  adminToken = auth.signSession(admin).token
  agentToken = auth.signSession(agent).token
  await new Promise((r) => (server = buildRelay(db, auth).listen(0, r)))
  base = `http://localhost:${server.address().port}`
})
afterAll(() => server?.close())

const call = (p, method, token) =>
  fetch(base + p, { method, headers: { Authorization: `Bearer ${token}` }, body: method === 'GET' || method === 'HEAD' ? undefined : 'x' }).then(async (r) => ({
    status: r.status,
    body: await r.json().catch(() => ({})),
  }))

describe('agency write lock', () => {
  it('is on for a new agency', () => {
    expect(db.getAgency(agencyId).readOnly).toBe(true)
  })

  it('refuses every write while on, for admins as well as agents', async () => {
    for (const token of [adminToken, agentToken]) {
      for (const method of ['POST', 'PUT', 'DELETE']) {
        const r = await call('/api/rest/clientes/', method, token)
        expect(r.status).toBe(403)
        expect(r.body.code).toBe('locked')
      }
      expect((await call('/api/photos', 'PUT', token)).body.code).toBe('locked')
    }
  })

  it('does not mistake a HEAD for a write', async () => {
    // HEAD is a GET without the body. Refusing it would mean a locked agency cannot even ask
    // whether a record exists, which the lock was never meant to prevent.
    db.setAgencyReadOnly(agencyId, true)
    expect((await call('/api/rest/clientes/?cod_cli=1', 'HEAD', adminToken)).status).not.toBe(403)
  })

  it('still allows reading while on', async () => {
    expect((await call('/api/rest/clientes/?cod_cli=1', 'GET', agentToken)).status).toBe(200)
  })

  it('allows writes once an admin lifts it, roles still applying', async () => {
    db.setAgencyReadOnly(agencyId, false)
    expect((await call('/api/rest/clientes/', 'POST', agentToken)).status).toBe(200)
    expect((await call('/api/photos', 'PUT', agentToken)).status).toBe(200)
    // the lock is lifted, but an agent still may not delete
    expect((await call('/api/rest/clientes/1', 'DELETE', agentToken)).body.code).toBe('role')
    expect((await call('/api/rest/clientes/1', 'DELETE', adminToken)).status).toBe(200)
  })

  it('blocks again as soon as it is turned back on', async () => {
    db.setAgencyReadOnly(agencyId, true)
    expect((await call('/api/rest/clientes/', 'POST', adminToken)).body.code).toBe('locked')
  })

  it('treats an unknown agency as locked', async () => {
    const orphan = auth.signSession({ id: 999, agency_id: 999, role: 'admin' }).token
    const r = await fetch(`${base}/api/rest/clientes/`, { method: 'POST', headers: { Authorization: `Bearer ${orphan}` }, body: 'x' })
    expect([401, 403]).toContain(r.status) // no such user/agency: never a pass-through
  })
})
