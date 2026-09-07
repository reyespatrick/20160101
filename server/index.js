import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFormBody, normalizeRequest, parseApiResponse } from './inmovilla.js'
import { mockResponse } from './mock.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 3000)
const API_URL = process.env.INMOVILLA_API_URL || 'https://apiweb.inmovilla.com/apiweb/apiweb.php'
const DOMAIN = process.env.INMOVILLA_DOMAIN || ''
const MOCK = process.env.INMOVILLA_MOCK === '1'
const UPSTREAM_TIMEOUT_MS = 20_000

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', true)
app.use(express.json({ limit: '64kb' }))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mock: MOCK })
})

/**
 * POST /api/inmovilla
 * body: { numagencia, password, idioma, requests: [{ type, pos, num, where, order }] }
 * Credentials are supplied by the logged in user and only travel through this proxy;
 * they are never stored server side.
 */
app.post('/api/inmovilla', async (req, res) => {
  const { numagencia, password, idioma, requests } = req.body || {}
  let normalized
  try {
    if (!Array.isArray(requests) || requests.length === 0 || requests.length > 5) {
      throw new Error('Provide between 1 and 5 requests')
    }
    normalized = requests.map(normalizeRequest)
    if (!numagencia || !password) throw new Error('Missing credentials')
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }

  const credentials = { numagencia, password, idioma: idioma || 1 }

  if (MOCK) {
    const data = mockResponse(credentials, normalized)
    if (data.error) return res.status(401).json({ error: data.error })
    return res.json(data)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    const body = buildFormBody(credentials, normalized, { clientIp: req.ip, domain: DOMAIN })
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
      return res.status(502).json({ error: `Inmovilla responded ${upstream.status}`, detail: text.slice(0, 300) })
    }
    const data = parseApiResponse(text)
    res.set('Cache-Control', 'no-store')
    return res.json(data)
  } catch (err) {
    const status = err.name === 'AbortError' ? 504 : err.status || 502
    return res.status(status).json({ error: err.message || 'Upstream error' })
  } finally {
    clearTimeout(timer)
  }
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
