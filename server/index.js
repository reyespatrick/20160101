import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFormBody, normalizeRequest, parseApiResponse } from './inmovilla.js'
import { mockResponse } from './mock.js'
import { requireAuth, signToken } from './auth.js'
import { ClientsStore } from './clientsStore.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 3000)
const API_URL = process.env.INMOVILLA_API_URL || 'https://apiweb.inmovilla.com/apiweb/apiweb.php'
const DOMAIN = process.env.INMOVILLA_DOMAIN || ''
const MOCK = process.env.INMOVILLA_MOCK === '1'
const UPSTREAM_TIMEOUT_MS = 20_000
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data')

const clients = new ClientsStore(path.join(DATA_DIR, 'clients.json'))
await clients.load()
clients.compact()
await clients.save()

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', true)
app.use(express.json({ limit: '64kb' }))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mock: MOCK })
})

/**
 * Forward one batch of queries to Inmovilla (or the mock) and return the parsed JSON.
 * Throws an Error with `.status` on failure.
 */
async function queryInmovilla(credentials, normalized, clientIp) {
  if (MOCK) {
    const data = mockResponse(credentials, normalized)
    if (data.error) throw Object.assign(new Error(data.error), { status: 401 })
    return data
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    const body = buildFormBody(credentials, normalized, { clientIp, domain: DOMAIN })
    const upstream = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'User-Agent': 'alma-inmovilla-pwa/0.1',
      },
      body,
      signal: controller.signal,
    })
    const text = await upstream.text()
    if (!upstream.ok) {
      throw Object.assign(new Error(`Inmovilla responded ${upstream.status}`), { status: 502, detail: text.slice(0, 300) })
    }
    return parseApiResponse(text)
  } catch (err) {
    if (err.name === 'AbortError') throw Object.assign(new Error('Inmovilla no responde'), { status: 504 })
    throw err
  } finally {
    clearTimeout(timer)
  }
}

function readCredentials(body) {
  const { numagencia, password, idioma } = body || {}
  if (!numagencia || !password) throw Object.assign(new Error('Missing credentials'), { status: 400 })
  return { numagencia: String(numagencia), password: String(password), idioma: Number(idioma) || 1 }
}

function sendError(res, err) {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502
  res.status(status).json({ error: err.message || 'Upstream error', detail: err.detail })
}

/**
 * POST /api/login  body: { numagencia, password, idioma }
 * Validates the credentials against Inmovilla with a minimal query and returns a
 * signed session token used by the clients API.
 */
app.post('/api/login', async (req, res) => {
  try {
    const credentials = readCredentials(req.body)
    await queryInmovilla(credentials, [normalizeRequest({ type: 'paginacion', pos: 1, num: 1 })], req.ip)
    const { token, expiresAt } = signToken(credentials.numagencia)
    res.set('Cache-Control', 'no-store')
    res.json({ token, expiresAt, agency: credentials.numagencia })
  } catch (err) {
    sendError(res, err)
  }
})

/**
 * POST /api/inmovilla
 * body: { numagencia, password, idioma, requests: [{ type, pos, num, where, order }] }
 * Credentials are supplied by the logged in user and only travel through this proxy;
 * they are never stored server side.
 */
app.post('/api/inmovilla', async (req, res) => {
  try {
    const { requests } = req.body || {}
    if (!Array.isArray(requests) || requests.length === 0 || requests.length > 5) {
      throw Object.assign(new Error('Provide between 1 and 5 requests'), { status: 400 })
    }
    let normalized
    try {
      normalized = requests.map(normalizeRequest)
    } catch (err) {
      throw Object.assign(err, { status: 400 })
    }
    const credentials = readCredentials(req.body)
    const data = await queryInmovilla(credentials, normalized, req.ip)
    res.set('Cache-Control', 'no-store')
    res.json(data)
  } catch (err) {
    sendError(res, err)
  }
})

/**
 * POST /api/clients/sync  (Bearer token)
 * body: { since: number, changes: [client...] }
 * Applies the device's pending changes (last write wins) and returns everything
 * that changed on the server after `since`, including other devices' edits.
 */
app.post('/api/clients/sync', requireAuth, async (req, res) => {
  const { since, changes } = req.body || {}
  if (changes !== undefined && !Array.isArray(changes)) return res.status(400).json({ error: 'changes must be an array' })
  if (Array.isArray(changes) && changes.length > 500) return res.status(400).json({ error: 'Too many changes in one batch' })
  const now = Date.now()
  const { accepted } = clients.apply(req.agency, changes || [], now)
  try {
    await clients.save()
  } catch (err) {
    console.error('[clients] save failed:', err.message)
    return res.status(500).json({ error: 'No se pudieron guardar los clientes en el servidor' })
  }
  const sinceTs = Number(since) || 0
  res.set('Cache-Control', 'no-store')
  res.json({ serverTime: now, accepted, changes: clients.list(req.agency, sinceTs) })
})

app.get('/api/clients', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ serverTime: Date.now(), changes: clients.list(req.agency, Number(req.query.since) || 0) })
})

// Serve the built PWA in production
const dist = path.join(__dirname, '..', 'dist')
app.use(express.static(dist, { index: 'index.html', maxAge: '1h' }))
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(dist, 'index.html'), (err) => {
    if (err) res.status(404).send('Build the app first: npm run build')
  })
})

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT} ${MOCK ? '(MOCK mode)' : `→ ${API_URL}`}`)
})
