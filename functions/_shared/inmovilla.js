/**
 * Inmovilla upstream calls from a Worker. The param building and the rate limiter come from
 * `server/inmovilla.js`, which is pure JS and runs unchanged on both runtimes.
 */
import { buildFormBody, createRateLimiter, normalizeRequest } from '../../server/inmovilla.js'
import { mockResponse } from '../../server/mock.js'

const APIWEB_URL = 'https://apiweb.inmovilla.com/apiweb/apiweb.php'
const REST_URL = 'https://procesos.inmovilla.com/api/v1'
const TIMEOUT_MS = 30_000

// One limiter per isolate. Inmovilla blocks an IP at 70 apiweb requests a minute.
let limiter
const slot = (env) => (limiter ||= createRateLimiter({ limit: Number(env.APIWEB_MAX_PER_MIN || 60) }))()

const isMock = (env) => env.INMOVILLA_MOCK === '1'

async function withTimeout(fn) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fn(controller.signal)
  } catch (err) {
    if (err.name === 'AbortError') throw Object.assign(new Error('Inmovilla no responde'), { status: 504 })
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** apiweb read. `requests` are the raw query descriptors; they are normalised here. */
export async function apiweb(env, creds, requests, { clientIp = '' } = {}) {
  const normalized = requests.map(normalizeRequest)
  if (isMock(env)) {
    const data = mockResponse({ numagencia: creds.numagencia, password: creds.password }, normalized)
    if (data.error) throw Object.assign(new Error(data.error), { status: 401 })
    return data
  }
  await slot(env)
  return withTimeout(async (signal) => {
    const res = await fetch(env.INMOVILLA_API_URL || APIWEB_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: buildFormBody({ numagencia: creds.numagencia, password: creds.password, idioma: creds.idioma }, normalized, { clientIp, domain: env.INMOVILLA_DOMAIN || '' }),
      signal,
    })
    const text = await res.text()
    if (!res.ok) throw Object.assign(new Error(`Inmovilla responded ${res.status}`), { status: 502 })
    try {
      return JSON.parse(text)
    } catch {
      throw Object.assign(new Error('Respuesta de Inmovilla ilegible'), { status: 502 })
    }
  })
}

/** Raw REST v1 relay: returns { status, type, body } so the caller can pass it through. */
export async function rest(env, token, method, path, contentType, body) {
  return withTimeout(async (signal) => {
    const headers = { Token: token, Accept: 'application/json' }
    if (body?.byteLength) headers['Content-Type'] = contentType || 'application/json'
    const res = await fetch((env.INMOVILLA_REST_URL || REST_URL).replace(/\/+$/, '') + path, {
      method,
      headers,
      body: body?.byteLength ? body : undefined,
      signal,
    })
    return { status: res.status, type: res.headers.get('content-type') || 'application/json', body: await res.arrayBuffer() }
  })
}

/** Both keys must be accepted by Inmovilla before an admin's change is stored. */
export async function verifyKeys(env, creds) {
  await apiweb(env, creds, [{ type: 'paginacion', pos: 1, num: 1 }])
  if (isMock(env)) {
    if (creds.restToken !== 'demo-token') throw Object.assign(new Error('Inmovilla rechazó la clave de la API REST (modo demo: usa "demo-token")'), { status: 401 })
    return
  }
  const r = await rest(env, creds.restToken, 'GET', '/clientes/buscar/?telefono=000000000', null, null)
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error('Inmovilla rechazó la clave de la API REST'), { status: 401 })
}
