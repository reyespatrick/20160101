/**
 * Inmovilla upstream calls from a Worker. The param building and the rate limiter come from
 * `server/inmovilla.js`, which is pure JS and runs unchanged on both runtimes.
 */
import { buildFormBody, createRateLimiter, headerValue, normalizeRequest } from '../../server/inmovilla.js'

const APIWEB_URL = 'https://apiweb.inmovilla.com/apiweb/apiweb.php'
const REST_URL = 'https://procesos.inmovilla.com/api/v1'
const TIMEOUT_MS = 30_000

// One limiter per isolate. Inmovilla blocks an IP at 70 apiweb requests a minute.
let limiter
const slot = (env) => (limiter ||= createRateLimiter({ limit: Number(env.APIWEB_MAX_PER_MIN || 60) }))()

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

/**
 * apiweb read. There is no mock branch on purpose: in development INMOVILLA_API_URL points at
 * `npm run mock:inmovilla`, so this code path is the same one production takes.
 */
export async function apiweb(env, creds, requests, { clientIp = '' } = {}) {
  const normalized = requests.map(normalizeRequest)
  await slot(env)
  return withTimeout(async (signal) => {
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }
    // When apiweb is reached through a fixed-IP hop (deploy/iis-hop), the hop checks this shared secret.
    if (env.APIWEB_HOP_SECRET) headers['X-Hop-Secret'] = headerValue(env.APIWEB_HOP_SECRET)
    const res = await fetch(env.INMOVILLA_API_URL || APIWEB_URL, {
      method: 'POST',
      headers,
      body: buildFormBody({ numagencia: creds.numagencia, password: creds.password, idioma: creds.idioma }, normalized, { clientIp, domain: env.INMOVILLA_DOMAIN || '' }),
      signal,
    })
    const text = await res.text()
    if (!res.ok) throw Object.assign(new Error(`Inmovilla responded ${res.status}`), { status: 502 })
    let data
    try {
      data = JSON.parse(text)
    } catch {
      // apiweb answers plain text on a rejected call ("NECESITAMOS RECIBIR LA IP", …);
      // pass it through, it is the only diagnosis the admin will get.
      const plain = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
      throw Object.assign(new Error(plain ? `Inmovilla: ${plain}` : 'Respuesta de Inmovilla ilegible'), { status: 502 })
    }
    // apiweb reports bad credentials in the body, with a 200
    if (data?.error) throw Object.assign(new Error(data.error), { status: 401 })
    return data
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

/**
 * The two Inmovilla keys are independent and are verified separately: an agency may hold the
 * REST token (writes) without the apiweb key (listing), which Inmovilla issues on request.
 *
 * The caller's IP must be forwarded: apiweb refuses a call without it
 * ("NECESITAMOS RECIBIR LA IP"), so verification would always fail otherwise.
 */
export async function verifyApiweb(env, creds, { clientIp = '' } = {}) {
  const listing = await apiweb(env, creds, [{ type: 'paginacion', pos: 1, num: 1 }], { clientIp })
  return { agencyName: await agencyName(env, creds, listing, { clientIp }) }
}

export async function verifyRest(env, restToken) {
  const r = await rest(env, restToken, 'GET', '/clientes/buscar/?telefono=000000000', null, null)
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error('Inmovilla rechazó la clave de la API REST'), { status: 401 })
}

/**
 * The agency's name as Inmovilla spells it, so nobody has to retype what the CRM already knows.
 * Purely cosmetic: any failure returns an empty string and never blocks saving the keys.
 */
async function agencyName(env, creds, listing, { clientIp }) {
  try {
    const first = Array.isArray(listing?.paginacion) ? listing.paginacion[1] : null
    if (!first?.cod_ofer) return ''
    const detail = await apiweb(env, creds, [{ type: 'ficha', pos: 1, num: 1, where: `cod_ofer=${Number(first.cod_ofer)}` }], { clientIp })
    const items = Array.isArray(detail?.ficha) ? detail.ficha.slice(1) : []
    return String(items[0]?.agencia || '').trim().slice(0, 120)
  } catch {
    return ''
  }
}
