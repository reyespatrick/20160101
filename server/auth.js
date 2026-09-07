/**
 * Stateless session tokens for the clients API.
 * payload = base64url(JSON{ agency, exp }) ; signature = HMAC-SHA256(secret, payload)
 */
import crypto from 'node:crypto'

const SECRET = process.env.APP_SECRET || crypto.randomBytes(32).toString('hex')
if (!process.env.APP_SECRET) {
  console.warn('[auth] APP_SECRET not set: sessions will be invalidated when the server restarts')
}
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30 // 30 days

function b64url(buf) {
  return Buffer.from(buf).toString('base64url')
}

export function signToken(agency, { ttlMs = TOKEN_TTL_MS, now = Date.now(), secret = SECRET } = {}) {
  const payload = b64url(JSON.stringify({ agency: String(agency), exp: now + ttlMs }))
  const sig = b64url(crypto.createHmac('sha256', secret).update(payload).digest())
  return { token: `${payload}.${sig}`, expiresAt: now + ttlMs }
}

export function verifyToken(token, { now = Date.now(), secret = SECRET } = {}) {
  if (typeof token !== 'string' || !token.includes('.')) return null
  const [payload, sig] = token.split('.')
  const expected = b64url(crypto.createHmac('sha256', secret).update(payload).digest())
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (!data.agency || typeof data.exp !== 'number' || data.exp < now) return null
    return { agency: String(data.agency), exp: data.exp }
  } catch {
    return null
  }
}

/** Express middleware: requires Authorization: Bearer <token>, sets req.agency */
export function requireAuth(req, res, next) {
  const header = req.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  const session = verifyToken(token)
  if (!session) return res.status(401).json({ error: 'Sesión caducada. Inicia sesión de nuevo.' })
  req.agency = session.agency
  next()
}
