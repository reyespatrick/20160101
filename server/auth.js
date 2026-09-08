/**
 * Session tokens (stateless, HMAC-signed) and role checks.
 * token = base64url(JSON{ uid, aid, role, exp }) . HMAC-SHA256
 */
import crypto from 'node:crypto'
import { getSecret, getUser } from './db.js'

const TTL_MS = 30 * 24 * 60 * 60_000
const b64 = (b) => Buffer.from(b).toString('base64url')

export function signSession(user, { now = Date.now() } = {}) {
  const payload = b64(JSON.stringify({ uid: user.id, aid: user.agency_id, role: user.role, exp: now + TTL_MS }))
  const sig = b64(crypto.createHmac('sha256', getSecret()).update(payload).digest())
  return { token: `${payload}.${sig}`, expiresAt: now + TTL_MS }
}

export function verifySession(token, { now = Date.now() } = {}) {
  if (typeof token !== 'string' || !token.includes('.')) return null
  const [payload, sig] = token.split('.')
  const expected = b64(crypto.createHmac('sha256', getSecret()).update(payload).digest())
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (!data.uid || typeof data.exp !== 'number' || data.exp < now) return null
    return data
  } catch {
    return null
  }
}

/** Express middleware: loads req.user (fresh from the DB so deactivation and role changes apply at once). */
export function requireUser(req, res, next) {
  const header = req.get('authorization') || ''
  const session = verifySession(header.startsWith('Bearer ') ? header.slice(7) : '')
  const user = session && getUser(session.uid)
  if (!user || !user.active) return res.status(401).json({ error: 'Sesión caducada. Inicia sesión de nuevo.', code: 'session' })
  req.user = user
  next()
}

export const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'No tienes permiso para esta acción', code: 'role' })
  next()
}

/** What each role may do against Inmovilla's write API. */
export function canWrite(role) {
  return role === 'admin' || role === 'agent'
}
export function canDelete(role) {
  return role === 'admin'
}
