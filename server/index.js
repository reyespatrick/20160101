/**
 * Immoba gateway.
 *
 *  - /api/account/*        accounts: agency setup, login, profile, Inmovilla keys (admin), users (admin)
 *  - POST /api/inmovilla   relays apiweb queries (read) with the agency's keys, for logged-in users
 *  - ANY  /api/rest/*      relays Inmovilla REST v1 (write) with the agency's token; roles enforced
 *  - PUT  /api/photos      hosts a listing photo (public URL for Inmovilla to download); write roles only
 *  - GET  /photos/:id.jpg  serves it
 *  - serves the built PWA
 *
 * Users log in with their own email/password. The Inmovilla keys are set by an admin, stored
 * encrypted in DATA_DIR/immoba.sqlite and never sent to the phone.
 */
import crypto from 'node:crypto'
import express from 'express'
import { mkdir, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAccountsRouter } from './accounts.js'
import { canDelete, canWrite, requireUser } from './auth.js'
import * as db from './db.js'
import { buildFormBody, normalizeRequest, parseApiResponse } from './inmovilla.js'
import { mockResponse } from './mock.js'
import { createMockRest } from './mockRest.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 3000)
const API_URL = process.env.INMOVILLA_API_URL || 'https://apiweb.inmovilla.com/apiweb/apiweb.php'
const REST_URL = (process.env.INMOVILLA_REST_URL || 'https://procesos.inmovilla.com/api/v1').replace(/\/+$/, '')
const DOMAIN = process.env.INMOVILLA_DOMAIN || ''
const MOCK = process.env.INMOVILLA_MOCK === '1'
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data')
const PHOTOS_DIR = process.env.PHOTOS_DIR || path.join(DATA_DIR, 'photos')
const PHOTO_TTL_DAYS = Number(process.env.PHOTO_TTL_DAYS || 30)
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '')
const UPSTREAM_TIMEOUT_MS = 30_000
const MAX_BODY = '12mb'
const MAX_PHOTO_BYTES = 8 * 1024 * 1024

db.openDb(DATA_DIR)
const mockRest = MOCK ? createMockRest() : null

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', true)

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mock: MOCK, apiweb: MOCK ? 'mock' : API_URL, rest: MOCK ? 'mock' : REST_URL, needsSetup: db.countUsers() === 0 })
})

// ---------------------------------------------------------------------------
// Inmovilla calls with the agency's keys
// ---------------------------------------------------------------------------
async function withTimeout(fn) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    return await fn(controller.signal)
  } catch (err) {
    if (err.name === 'AbortError') throw Object.assign(new Error('Inmovilla no responde'), { status: 504 })
    throw err
  } finally {
    clearTimeout(timer)
  }
}

async function apiwebQuery(creds, normalized, clientIp) {
  if (MOCK) {
    const data = mockResponse({ numagencia: creds.numagencia, password: creds.password }, normalized)
    if (data.error) throw Object.assign(new Error(data.error), { status: 401 })
    return data
  }
  return withTimeout(async (signal) => {
    const upstream = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': 'immoba/0.4' },
      body: buildFormBody({ numagencia: creds.numagencia, password: creds.password, idioma: creds.idioma }, normalized, { clientIp, domain: DOMAIN }),
      signal,
    })
    const text = await upstream.text()
    if (!upstream.ok) throw Object.assign(new Error(`Inmovilla responded ${upstream.status}`), { status: 502 })
    return parseApiResponse(text)
  })
}

/** Raw REST relay: returns { status, type, body } */
async function restRelay(token, method, urlPath, contentType, body) {
  if (MOCK) return mockRest.call(token, method, urlPath, contentType, body)
  return withTimeout(async (signal) => {
    const headers = { Token: token, Accept: 'application/json', 'User-Agent': 'immoba/0.4' }
    if (body?.length) headers['Content-Type'] = contentType || 'application/json'
    const upstream = await fetch(REST_URL + urlPath, { method, headers, body: body?.length ? body : undefined, signal })
    return { status: upstream.status, type: upstream.headers.get('content-type') || 'application/json', body: Buffer.from(await upstream.arrayBuffer()) }
  })
}

/** Used when an admin saves keys: both must be accepted by Inmovilla. */
async function verifyInmovillaKeys(creds) {
  await apiwebQuery(creds, [normalizeRequest({ type: 'paginacion', pos: 1, num: 1 })], '')
  const r = await restRelay(creds.restToken, 'GET', '/clientes/buscar/?telefono=000000000', null, null)
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error('Inmovilla rechazó la clave de la API REST'), { status: 401 })
}

app.use('/api/account', createAccountsRouter({ verifyInmovillaKeys }))

/** Loads the agency's Inmovilla credentials or answers 409 when the admin has not set them. */
function requireKeys(req, res, next) {
  const creds = db.agencyCredentials(req.user.agency_id)
  if (!creds || !creds.numagencia || !creds.password || !creds.restToken) {
    return res.status(409).json({ error: 'La agencia aún no tiene configuradas las claves de Inmovilla', code: 'keys' })
  }
  req.creds = creds
  next()
}

// ---------------------------------------------------------------------------
// apiweb relay (read) — any active user
// ---------------------------------------------------------------------------
app.post('/api/inmovilla', requireUser, requireKeys, express.json({ limit: '64kb' }), async (req, res) => {
  const { requests, idioma } = req.body || {}
  let normalized
  try {
    if (!Array.isArray(requests) || requests.length === 0 || requests.length > 5) throw new Error('Provide between 1 and 5 requests')
    normalized = requests.map(normalizeRequest)
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
  res.set('Cache-Control', 'no-store')
  try {
    res.json(await apiwebQuery({ ...req.creds, idioma: Number(idioma) || req.creds.idioma }, normalized, req.ip))
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message || 'Upstream error' })
  }
})

// ---------------------------------------------------------------------------
// REST relay (write) — roles: readonly may only GET; agents may not DELETE
// ---------------------------------------------------------------------------
app.use('/api/rest', requireUser, requireKeys, express.raw({ type: () => true, limit: MAX_BODY }), async (req, res) => {
  const method = req.method.toUpperCase()
  if (method !== 'GET' && !canWrite(req.user.role)) return res.status(403).json({ error: 'Tu cuenta es de solo lectura', code: 'role' })
  if (method === 'DELETE' && !canDelete(req.user.role)) return res.status(403).json({ error: 'Solo un administrador puede eliminar en Inmovilla', code: 'role' })
  try {
    const r = await restRelay(req.creds.restToken, method, req.url, req.get('content-type'), Buffer.isBuffer(req.body) ? req.body : null)
    res.status(r.status).set('Cache-Control', 'no-store').type(r.type).send(r.body)
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// Photo hosting for Inmovilla to fetch — write roles only
// ---------------------------------------------------------------------------
app.put('/api/photos', requireUser, express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'], limit: MAX_PHOTO_BYTES }), async (req, res) => {
  if (!canWrite(req.user.role)) return res.status(403).json({ error: 'Tu cuenta es de solo lectura', code: 'role' })
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
  res.set('Cache-Control', 'public, max-age=31536000, immutable').type('image/jpeg')
  res.sendFile(path.join(PHOTOS_DIR, `${req.params.id}.jpg`), (err) => err && res.status(404).end())
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

if (MOCK) {
  app.use('/mock-photos', express.static(process.env.MOCK_PHOTOS_DIR || path.join(DATA_DIR, 'mock-photos'), { maxAge: '1d' }))
}

// ---------------------------------------------------------------------------
// Built PWA
// ---------------------------------------------------------------------------
const dist = path.join(__dirname, '..', 'dist')
app.use(express.static(dist, { index: 'index.html', maxAge: '1h' }))
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(dist, 'index.html'), (err) => err && res.status(404).send('Build the app first: npm run build'))
})

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`)
  console.log(`[server] apiweb → ${MOCK ? 'MOCK (agencia 1234 / clave demo)' : API_URL}`)
  console.log(`[server] REST   → ${MOCK ? 'MOCK (token "demo-token")' : REST_URL}`)
  console.log(`[server] data   → ${DATA_DIR} (accounts + encrypted keys), photos kept ${PHOTO_TTL_DAYS} days${PUBLIC_URL ? ` at ${PUBLIC_URL}/photos/` : ''}`)
  if (db.countUsers() === 0) console.log('[server] no users yet: open the app to create the agency and its administrator')
})
