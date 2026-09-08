/**
 * Stateless gateway for the Immoba PWA.
 *
 *  - POST /api/inmovilla  → relays queries to Inmovilla's legacy "apiweb" (read: listings, fichas, types).
 *  - ANY  /api/rest/*     → relays to Inmovilla's REST API v1 with the user's token (write: clients,
 *                           listings, photos). The token travels in the X-Inmovilla-Token header of
 *                           each request and is never stored here.
 *  - PUT  /api/photos      → stores a listing photo and returns its public URL (Inmovilla fetches
 *                           photos by URL). Files are purged after PHOTO_TTL_DAYS.
 *  - GET  /photos/:id.jpg  → serves it.
 *  - serves the built PWA.
 *
 * Why a server at all: the browser cannot call apiweb directly (no CORS, whitelisted server IPs only),
 * so this process must run on a machine whose IP Inmovilla has authorised. It keeps no data.
 */
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFormBody, normalizeRequest, parseApiResponse } from './inmovilla.js'
import { mockResponse } from './mock.js'
import { createMockRest } from './mockRest.js'
import crypto from 'node:crypto'
import { mkdir, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 3000)
const API_URL = process.env.INMOVILLA_API_URL || 'https://apiweb.inmovilla.com/apiweb/apiweb.php'
const REST_URL = (process.env.INMOVILLA_REST_URL || 'https://procesos.inmovilla.com/api/v1').replace(/\/+$/, '')
const DOMAIN = process.env.INMOVILLA_DOMAIN || ''
const MOCK = process.env.INMOVILLA_MOCK === '1'
const UPSTREAM_TIMEOUT_MS = 30_000
const MAX_BODY = '12mb'
// Photo hosting: Inmovilla's REST API downloads listing photos from public URLs, so the
// relay keeps the uploaded files for a while at unguessable addresses. This is the only
// thing the server stores.
const PHOTOS_DIR = process.env.PHOTOS_DIR || path.join(__dirname, '..', 'data', 'photos')
const PHOTO_TTL_DAYS = Number(process.env.PHOTO_TTL_DAYS || 30)
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '')
const MAX_PHOTO_BYTES = 8 * 1024 * 1024

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', true)

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mock: MOCK, apiweb: MOCK ? 'mock' : API_URL, rest: MOCK ? 'mock' : REST_URL })
})

// ---------------------------------------------------------------------------
// apiweb relay (read)
// ---------------------------------------------------------------------------
app.post('/api/inmovilla', express.json({ limit: '64kb' }), async (req, res) => {
  const { numagencia, password, idioma, requests } = req.body || {}
  let normalized
  try {
    if (!Array.isArray(requests) || requests.length === 0 || requests.length > 5) throw new Error('Provide between 1 and 5 requests')
    normalized = requests.map(normalizeRequest)
    if (!numagencia || !password) throw new Error('Missing credentials')
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
  const credentials = { numagencia: String(numagencia), password: String(password), idioma: Number(idioma) || 1 }
  res.set('Cache-Control', 'no-store')

  if (MOCK) {
    const data = mockResponse(credentials, normalized)
    return data.error ? res.status(401).json({ error: data.error }) : res.json(data)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    const upstream = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': 'immoba/0.3' },
      body: buildFormBody(credentials, normalized, { clientIp: req.ip, domain: DOMAIN }),
      signal: controller.signal,
    })
    const text = await upstream.text()
    if (!upstream.ok) return res.status(502).json({ error: `Inmovilla responded ${upstream.status}`, detail: text.slice(0, 300) })
    return res.json(parseApiResponse(text))
  } catch (err) {
    const status = err.name === 'AbortError' ? 504 : err.status || 502
    return res.status(status).json({ error: err.message || 'Upstream error' })
  } finally {
    clearTimeout(timer)
  }
})

// ---------------------------------------------------------------------------
// REST API v1 relay (write) — the user's token is forwarded, nothing is kept
// ---------------------------------------------------------------------------
if (MOCK) {
  app.use('/api/rest', createMockRest().router)
  // sample listing photos for the mock (generate them with scripts/generate-mock-photos.mjs)
  app.use('/mock-photos', express.static(process.env.MOCK_PHOTOS_DIR || path.join(__dirname, '..', 'data', 'mock-photos'), { maxAge: '1d' }))
} else {
  app.use('/api/rest', express.raw({ type: () => true, limit: MAX_BODY }), async (req, res) => {
    const token = req.get('x-inmovilla-token')
    if (!token) return res.status(401).json({ error: 'Falta la clave de la API REST de Inmovilla' })
    const target = REST_URL + req.url // req.url is already relative to /api/rest and keeps the query string
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
    try {
      const headers = { Token: token, Accept: 'application/json', 'User-Agent': 'immoba/0.3' }
      const hasBody = !['GET', 'HEAD'].includes(req.method) && Buffer.isBuffer(req.body) && req.body.length > 0
      if (hasBody) headers['Content-Type'] = req.get('content-type') || 'application/json'
      const upstream = await fetch(target, { method: req.method, headers, body: hasBody ? req.body : undefined, signal: controller.signal })
      res.status(upstream.status)
      res.set('Cache-Control', 'no-store')
      const type = upstream.headers.get('content-type')
      if (type) res.type(type)
      res.send(Buffer.from(await upstream.arrayBuffer()))
    } catch (err) {
      res.status(err.name === 'AbortError' ? 504 : 502).json({ error: err.name === 'AbortError' ? 'Inmovilla no responde' : err.message })
    } finally {
      clearTimeout(timer)
    }
  })
}

// ---------------------------------------------------------------------------
// Photo hosting for Inmovilla to fetch
// ---------------------------------------------------------------------------
const tokenCache = new Map() // token -> expiry; avoids hitting Inmovilla for every upload
async function tokenIsValid(token) {
  if (!token) return false
  if (MOCK) return token === 'demo-token'
  const cached = tokenCache.get(token)
  if (cached && cached > Date.now()) return true
  try {
    const res = await fetch(`${REST_URL}/clientes/buscar/?telefono=000000000`, { headers: { Token: token, Accept: 'application/json' } })
    if (res.status === 401 || res.status === 403) return false
    tokenCache.set(token, Date.now() + 60 * 60_000)
    return true
  } catch {
    return false
  }
}

app.put('/api/photos', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'], limit: MAX_PHOTO_BYTES }), async (req, res) => {
  if (!(await tokenIsValid(req.get('x-inmovilla-token')))) return res.status(401).json({ error: 'Clave de la API REST no válida' })
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: 'Foto vacía' })
  const id = crypto.randomBytes(16).toString('hex')
  try {
    await mkdir(PHOTOS_DIR, { recursive: true })
    const target = path.join(PHOTOS_DIR, `${id}.jpg`)
    await writeFile(`${target}.tmp`, req.body)
    await rename(`${target}.tmp`, target)
  } catch (err) {
    console.error('[photos] write failed:', err.message)
    return res.status(500).json({ error: 'No se pudo guardar la foto' })
  }
  const base = PUBLIC_URL || `${req.protocol}://${req.get('host')}`
  res.json({ id, url: `${base}/photos/${id}.jpg` })
})

app.get('/photos/:id.jpg', (req, res) => {
  if (!/^[a-f0-9]{32}$/.test(req.params.id)) return res.status(404).end()
  res.set('Cache-Control', 'public, max-age=31536000, immutable')
  res.type('image/jpeg')
  res.sendFile(path.join(PHOTOS_DIR, `${req.params.id}.jpg`), (err) => {
    if (err) res.status(404).end()
  })
})

async function purgeOldPhotos() {
  try {
    const cutoff = Date.now() - PHOTO_TTL_DAYS * 86_400_000
    for (const file of await readdir(PHOTOS_DIR)) {
      const full = path.join(PHOTOS_DIR, file)
      const info = await stat(full).catch(() => null)
      if (info?.isFile() && info.mtimeMs < cutoff) await unlink(full).catch(() => {})
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[photos] purge failed:', err.message)
  }
}
purgeOldPhotos()
setInterval(purgeOldPhotos, 60 * 60_000).unref()

// ---------------------------------------------------------------------------
// Built PWA
// ---------------------------------------------------------------------------
const dist = path.join(__dirname, '..', 'dist')
app.use(express.static(dist, { index: 'index.html', maxAge: '1h' }))
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(dist, 'index.html'), (err) => {
    if (err) res.status(404).send('Build the app first: npm run build')
  })
})

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`)
  console.log(`[server] apiweb → ${MOCK ? 'MOCK' : API_URL}`)
  console.log(`[server] REST   → ${MOCK ? 'MOCK (token "demo-token")' : REST_URL}`)
  console.log(`[server] photos → ${PHOTOS_DIR} (kept ${PHOTO_TTL_DAYS} days${PUBLIC_URL ? `, public at ${PUBLIC_URL}/photos/` : ''})`)
})
