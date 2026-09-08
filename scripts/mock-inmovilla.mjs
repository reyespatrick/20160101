/**
 * A standalone fake Inmovilla for local development: the apiweb form endpoint and the REST v1
 * API, on one port.
 *
 * It exists so the Cloudflare functions need no mock branch at all — they simply call whatever
 * INMOVILLA_API_URL and INMOVILLA_REST_URL point at, exercising the real HTTP path in dev.
 *
 *   node scripts/mock-inmovilla.mjs        # http://localhost:3001
 *   agency 1234 / web key "demo" / REST token "demo-token"
 */
import express from 'express'
import { mockResponse } from '../server/mock.js'
import { createMockRest } from '../server/mockRest.js'

const PORT = Number(process.env.MOCK_PORT || 3001)
const app = express()
app.disable('x-powered-by')

/** `numagencia;password;idioma;lostipos;type;pos;num;where;order[;type;...]` */
function parseParam(param) {
  const parts = String(param || '').split(';')
  const [numagencia, password, idioma] = parts
  const requests = []
  for (let i = 4; i + 4 < parts.length + 1; i += 5) {
    if (!parts[i]) break
    requests.push({ type: parts[i], pos: Number(parts[i + 1]) || 1, num: Number(parts[i + 2]) || 20, where: parts[i + 3] || '', order: parts[i + 4] || '' })
  }
  return { numagencia, password, idioma: Number(idioma) || 1, requests }
}

app.post('/apiweb/apiweb.php', express.urlencoded({ extended: false, limit: '256kb' }), (req, res) => {
  const { numagencia, password, requests } = parseParam(req.body.param)
  if (!requests.length) return res.json({ error: 'Sin consultas' })
  res.json(mockResponse({ numagencia, password }, requests))
})

app.use('/api/v1', createMockRest().router)

app.use((_req, res) => res.status(404).json({ codigo: 404, mensaje: 'Ruta desconocida en el mock' }))

app.listen(PORT, () => {
  console.log(`[mock-inmovilla] http://localhost:${PORT}`)
  console.log(`[mock-inmovilla]   apiweb → POST /apiweb/apiweb.php   (agencia 1234 / clave demo)`)
  console.log(`[mock-inmovilla]   REST   → /api/v1/*                 (token "demo-token")`)
})
