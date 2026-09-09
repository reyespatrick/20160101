/**
 * Helpers for the Inmovilla "apiweb" JSON API.
 *
 * The API is a single POST endpoint. Credentials and one or more queries are
 * packed into a semicolon separated `param` string:
 *
 *   numagencia;password;idioma;lostipos;type;pos;num;where;order[;type;pos;num;where;order...]
 *
 * Every response key is an array whose first element is pagination metadata
 * ({ posicion, elementos, total }) followed by the items.
 */

export const QUERY_TYPES = new Set([
  'paginacion', // property list
  'ficha', // property detail (where: cod_ofer=123)
  'destacados', // featured properties
  'lostipos', // property types
  'ciudades', // cities
  'zonas', // zones
  'provincias', // provinces
])

const FIELD_SEPARATOR = ';'

function clean(value) {
  // Semicolons are the protocol separator, never let user input inject one.
  return String(value ?? '').replace(/;/g, ' ').trim()
}

function toInt(value, fallback, { min = 1, max = 999 } = {}) {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export function normalizeRequest(req) {
  if (!req || typeof req !== 'object') throw new Error('Invalid request item')
  const type = clean(req.type)
  if (!QUERY_TYPES.has(type)) throw new Error(`Unsupported query type "${type}"`)
  return {
    type,
    pos: toInt(req.pos, 1, { min: 1, max: 1_000_000 }),
    num: toInt(req.num, 20),
    where: clean(req.where),
    order: clean(req.order),
  }
}

/**
 * Sliding-window limiter for calls to a single upstream.
 *
 * Inmovilla blocks an IP for 10 minutes when it reaches 70 apiweb requests in a minute,
 * and permanently after 10 such blocks, so the relay must stay under that on its own.
 * Slots are handed out one at a time (the queue) so concurrent callers cannot all pass
 * the check at once; a caller waits its turn and gives up only past `maxWaitMs`.
 */
export function createRateLimiter({ limit, windowMs = 60_000, maxWaitMs = 15_000, now = () => Date.now(), sleep } = {}) {
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)))
  const calls = []
  let queue = Promise.resolve()

  const take = async () => {
    for (;;) {
      const t = now()
      while (calls.length && t - calls[0] >= windowMs) calls.shift()
      if (calls.length < limit) {
        calls.push(t)
        return
      }
      const delay = windowMs - (t - calls[0]) + 25
      if (delay > maxWaitMs) throw Object.assign(new Error('Demasiadas consultas a Inmovilla; espera un momento'), { status: 429 })
      await wait(delay)
    }
  }
  const slot = () => {
    const p = queue.then(take, take)
    queue = p.catch(() => {})
    return p
  }
  slot.pending = () => calls.length
  return slot
}

/**
 * An HTTP header value travels as bytes, and both runtimes turn a JS string into bytes as Latin-1.
 * A secret carrying an accent would therefore leave as 0xE9 while the IIS hop reads its headers as
 * UTF-8 and expects 0xC3 0xA9, so the comparison fails. Re-encode non-ASCII values to their UTF-8
 * bytes; pure ASCII (the usual case) is returned untouched.
 */
export function headerValue(value) {
  const text = String(value == null ? '' : value)
  if (!/[^\x20-\x7e]/.test(text)) return text
  let out = ''
  for (const byte of new TextEncoder().encode(text)) out += String.fromCharCode(byte)
  return out
}

export function buildParam({ numagencia, password, idioma = 1 }, requests) {
  if (!clean(numagencia)) throw new Error('numagencia is required')
  if (!clean(password)) throw new Error('password is required')
  if (!Array.isArray(requests) || requests.length === 0) {
    throw new Error('At least one request is required')
  }
  const parts = [clean(numagencia), clean(password), toInt(idioma, 1, { min: 1, max: 20 }), 'lostipos']
  for (const raw of requests) {
    const r = normalizeRequest(raw)
    parts.push(r.type, r.pos, r.num, r.where, r.order)
  }
  return parts.join(FIELD_SEPARATOR)
}

export function buildFormBody(credentials, requests, { clientIp = '', domain = '' } = {}) {
  const body = new URLSearchParams()
  body.set('param', buildParam(credentials, requests))
  body.set('json', '1')
  // The visitor's IP, used by Inmovilla to attribute leads (both names appear in their docs)
  if (clientIp) {
    body.set('ia', clientIp)
    body.set('ib', clientIp)
  }
  if (domain) body.set('elDominio', domain)
  return body
}

/**
 * Convert an API section (meta first, then items) into { meta, items }.
 */
export function splitSection(section) {
  if (!Array.isArray(section) || section.length === 0) {
    return { meta: { posicion: 1, elementos: 0, total: 0 }, items: [] }
  }
  const [meta, ...items] = section
  return {
    meta: {
      posicion: Number(meta?.posicion ?? 1),
      elementos: Number(meta?.elementos ?? items.length),
      total: Number(meta?.total ?? items.length),
    },
    items,
  }
}

/**
 * Inmovilla replies with HTTP 200 even on errors; the body is then a string
 * or an object with an "error" key instead of the expected sections.
 */
export function parseApiResponse(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    const msg = String(text).trim().slice(0, 300)
    throw Object.assign(new Error(msg || 'Empty response from Inmovilla'), { status: 502 })
  }
  if (!data || typeof data !== 'object') {
    throw Object.assign(new Error('Unexpected response from Inmovilla'), { status: 502 })
  }
  if (data.error) {
    throw Object.assign(new Error(String(data.error)), { status: 401 })
  }
  return data
}
