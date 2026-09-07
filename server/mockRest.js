/**
 * In-memory stand-in for Inmovilla's REST API v1, used only when INMOVILLA_MOCK=1
 * so the app can be exercised locally without a token. Shapes follow the mapping in
 * src/api/inmovillaMapping.js; adjust both together once the real contract is confirmed.
 *
 * Accepts the demo token "demo-token" only.
 */
import express from 'express'

const TOKEN = 'demo-token'

export function createMockRest() {
  const router = express.Router()
  const db = { clientes: new Map(), propiedades: new Map(), fotos: new Map(), nextId: 5000 }
  const nextId = () => String(db.nextId++)

  router.use((req, res, next) => {
    // The real relay maps X-Inmovilla-Token → Token; in mock mode the router is mounted directly, so accept both.
    const token = req.get('token') || req.get('x-inmovilla-token')
    if (token !== TOKEN) return res.status(401).json({ error: 'Token no válido (modo demo: usa "demo-token")' })
    next()
  })
  router.use(express.json({ limit: '12mb' }))

  const collection = (name) => {
    router.get(`/${name}`, (req, res) => {
      const items = [...db[name].values()]
      const q = String(req.query.q || '').toLowerCase()
      res.json({ data: q ? items.filter((i) => JSON.stringify(i).toLowerCase().includes(q)) : items, total: items.length })
    })
    router.get(`/${name}/:id`, (req, res) => {
      const item = db[name].get(req.params.id)
      item ? res.json(item) : res.status(404).json({ error: 'No encontrado' })
    })
    router.post(`/${name}`, (req, res) => {
      if (name === 'clientes' && !req.body?.nombre) return res.status(400).json({ error: 'El campo nombre es obligatorio' })
      if (name === 'propiedades' && !req.body?.ciudad) return res.status(400).json({ error: 'El campo ciudad es obligatorio' })
      const id = nextId()
      const item = { ...req.body, id, fechaalta: new Date().toISOString() }
      if (name === 'propiedades') item.cod_ofer = Number(id)
      db[name].set(id, item)
      res.status(201).json(item)
    })
    router.put(`/${name}/:id`, (req, res) => {
      if (!db[name].has(req.params.id)) return res.status(404).json({ error: 'No encontrado' })
      const item = { ...db[name].get(req.params.id), ...req.body, id: req.params.id }
      db[name].set(req.params.id, item)
      res.json(item)
    })
    router.delete(`/${name}/:id`, (req, res) => {
      db[name].delete(req.params.id)
      res.json({ ok: true })
    })
  }
  collection('clientes')
  collection('propiedades')

  router.post('/propiedades/:id/fotos', (req, res) => {
    if (!db.propiedades.has(req.params.id)) return res.status(404).json({ error: 'Propiedad no encontrada' })
    if (!req.body?.foto) return res.status(400).json({ error: 'Falta la foto' })
    const id = nextId()
    const list = db.fotos.get(req.params.id) || []
    list.push({ id, orden: req.body.orden ?? list.length, size: Buffer.from(req.body.foto, 'base64').length })
    db.fotos.set(req.params.id, list)
    db.propiedades.get(req.params.id).numfotos = list.length
    res.status(201).json({ id })
  })
  router.get('/propiedades/:id/fotos', (req, res) => res.json({ data: db.fotos.get(req.params.id) || [] }))

  router.use((_req, res) => res.status(404).json({ error: 'Endpoint no disponible en el mock' }))
  return { router, db }
}
