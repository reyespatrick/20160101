/**
 * In-memory stand-in for Inmovilla's REST API v1 (documentation "API REST v.1"),
 * used only when INMOVILLA_MOCK=1. Accepts the demo token "demo-token".
 * Listings saved here also appear in the mock apiweb listing (server/mock.js).
 */
import express from 'express'
import { CITIES, CITY_KEY_BASE, TYPES, ZONES, upsertMockProperty, zoneKey } from './mock.js'

const TOKEN = 'demo-token'
const err = (res, status, codigo, mensaje) => res.status(status).json({ codigo, mensaje })

const ENUMS = {
  keyacci: [{ nombre: 'Vender', valor: 1 }, { nombre: 'Alquilar', valor: 2 }],
  key_tipo: TYPES.map(([valor, nombre]) => ({ nombre, valor })),
  conservacion: [{ nombre: 'Obra nueva', valor: 1 }, { nombre: 'Buen estado', valor: 2 }, { nombre: 'A reformar', valor: 3 }, { nombre: 'Reformado', valor: 4 }],
  keyori: ['Norte', 'Sur', 'Este', 'Oeste', 'Noreste', 'Noroeste', 'Sureste', 'Suroeste'].map((nombre, i) => ({ nombre, valor: i + 1 })),
  eninternet: [{ nombre: 'No publicar', valor: 0 }, { nombre: 'Web', valor: 1 }, { nombre: 'Web y portales', valor: 2 }],
  estadoficha: [{ nombre: 'Disponible', valor: 1 }, { nombre: 'Reservado', valor: 2 }, { nombre: 'Vendido', valor: 3 }],
}

export function createMockRest() {
  const router = express.Router()
  const db = { clientes: new Map(), propiedades: new Map(), propietarios: new Map(), nextId: 5000 }
  const nextId = () => db.nextId++
  const isNumeric = (v) => v === undefined || (typeof v === 'number' && Number.isFinite(v))

  router.use((req, res, next) => {
    const token = req.get('token') || req.get('x-inmovilla-token')
    if (token !== TOKEN) return err(res, 401, 401001, 'Token no válido (modo demo: usa "demo-token")')
    next()
  })
  router.use(express.json({ limit: '2mb' }))

  // ---- enums ----
  router.get('/enums/', (req, res) => {
    if ('tipos' in req.query) {
      const name = req.query.tipos
      if (name && name !== '') return ENUMS[name] ? res.json({ [name]: ENUMS[name] }) : err(res, 404, 404001, 'No existe el tipo')
      return res.json(ENUMS)
    }
    if ('ciudades' in req.query) {
      return res.json([{ pais: 724, provincia: 'ALICANTE', cod_prov: 4, ciudades: CITIES.map((ciudad, i) => ({ ciudad, key_loca: CITY_KEY_BASE + i })) }])
    }
    if ('zonas' in req.query) {
      const keys = String(req.query.zonas).split(',').map((k) => Number(k.trim()))
      if (keys.some((k) => !Number.isFinite(k))) return err(res, 400, 400005, "key_loca incorrecto (debe ser númerico y separado por ',')")
      const out = {}
      for (const k of keys) {
        if (k < CITY_KEY_BASE || k >= CITY_KEY_BASE + CITIES.length) return err(res, 404, 404002, 'No existe el key_loca (ciudad)')
        out[k] = ZONES.map((zona, i) => ({ zona, key_zona: zoneKey(k, i) }))
      }
      return res.json(out)
    }
    if ('calidades' in req.query) return res.json([{ campo: 'ascensor', valores: 'true/false' }, { campo: 'terraza', valores: 'true/false' }])
    return err(res, 400, 400008, 'Parámetro incorrecto')
  })

  // ---- clientes ----
  router.get('/clientes/buscar/', (req, res) => {
    const { telefono, email } = req.query
    if (!telefono && !email) return err(res, 400, 400002, 'No se han enviado parámetros')
    const digits = String(telefono || '').replace(/\D/g, '')
    const found = [...db.clientes.values()].filter(
      (c) =>
        (!telefono || [c.telefono1, c.telefono2, c.telefono3].some((t) => t && String(t) === digits)) &&
        (!email || String(c.email || '').toLowerCase() === String(email).toLowerCase()),
    )
    if (!found.length) return err(res, 404, 404002, 'Sin resultados')
    res.json(found.map((c) => ({ ...c, agente: { id: '1', nombre: 'Ana', apellidos: 'García' } })))
  })
  router.get('/clientes/', (req, res) => {
    const c = db.clientes.get(String(req.query.cod_cli))
    c ? res.json(c) : err(res, 404, 404002, 'Sin resultados')
  })
  router.post('/clientes/', (req, res) => {
    const b = req.body || {}
    if (!b.nombre) return err(res, 406, 406001, 'Campo nombre requerido')
    for (const f of ['telefono1', 'telefono2', 'telefono3', 'prefijotel1', 'prefijotel2']) if (!isNumeric(b[f])) return err(res, 406, 406002, `Campo ${f} no válido`)
    const cod_cli = nextId()
    db.clientes.set(String(cod_cli), { ...b, cod_cli: String(cod_cli), altacliente: new Date().toISOString().slice(0, 19).replace('T', ' ') })
    res.status(201).json({ cod_cli, codigo: 201, mensaje: 'Cliente creado' })
  })
  router.put('/clientes/', (req, res) => {
    const b = req.body || {}
    if (!b.cod_cli) return err(res, 406, 406001, 'Campo cod_cli requerido')
    const existing = db.clientes.get(String(b.cod_cli))
    if (!existing) return err(res, 406, 406006, `Código ${b.cod_cli} no existe`)
    db.clientes.set(String(b.cod_cli), { ...existing, ...b, cod_cli: String(b.cod_cli) })
    res.status(202).json({ cod_cli: Number(b.cod_cli), codigo: 202, mensaje: 'Cliente actualizado' })
  })
  router.delete('/clientes/:cod_cli', (req, res) => {
    if (!db.clientes.has(req.params.cod_cli)) return err(res, 406, 406006, `Código ${req.params.cod_cli} no existe`)
    db.clientes.delete(req.params.cod_cli)
    res.json({ codigo: 200, mensaje: 'Cliente eliminado' })
  })

  // ---- propiedades ----
  router.get('/propiedades/', (req, res) => {
    if ('listado' in req.query) {
      return res.json([...db.propiedades.values()].map((p) => ({ cod_ofer: p.cod_ofer, ref: p.ref, nodisponible: Boolean(p.nodisponible), prospecto: Boolean(p.prospecto), fechaact: p.fechaact })))
    }
    const p = req.query.cod_ofer ? [...db.propiedades.values()].find((x) => String(x.cod_ofer) === String(req.query.cod_ofer)) : db.propiedades.get(String(req.query.ref))
    p ? res.json(p) : err(res, 404, 404001, 'Sin resultados')
  })
  router.post('/propiedades/', (req, res) => {
    const b = req.body || {}
    for (const f of ['ref', 'keyacci', 'key_tipo', 'key_loca']) if (b[f] === undefined || b[f] === '') return err(res, 406, 406001, `Campo ${f} requerido`)
    for (const f of ['precioinmo', 'precioalq', 'habitaciones', 'banyos', 'm_cons', 'm_utiles', 'm_parcela', 'planta', 'antiguedad']) {
      if (!isNumeric(b[f])) return err(res, 406, 406002, `Campo ${f} no válido`)
    }
    if (b.fotos !== undefined && (typeof b.fotos !== 'object' || Array.isArray(b.fotos))) return err(res, 406, 406002, 'Campo fotos no válido')
    const existing = db.propiedades.get(String(b.ref))
    const record = { ...b, cod_ofer: existing?.cod_ofer || nextId(), fechaact: new Date().toISOString().slice(0, 19).replace('T', ' ') }
    db.propiedades.set(String(b.ref), record)
    upsertMockProperty(record)
    res.status(201).json({ codigo: 201, mensaje: 'Propiedad guardada' })
  })

  // ---- propietarios ----
  router.get('/propietarios/', (req, res) => {
    const o = req.query.cod_cli ? db.propietarios.get(String(req.query.cod_cli)) : [...db.propietarios.values()].find((x) => String(x.cod_ofer) === String(req.query.cod_ofer))
    o ? res.json(o) : err(res, 404, 404001, 'Sin resultados')
  })
  router.post('/propietarios/', (req, res) => {
    const b = req.body || {}
    if (!b.cod_ofer) return err(res, 406, 406001, 'Campo cod_ofer requerido')
    if (!b.nombre) return err(res, 406, 406001, 'Campo nombre requerido')
    if (![...db.propiedades.values()].some((p) => String(p.cod_ofer) === String(b.cod_ofer))) return err(res, 404, 404001, 'Sin resultados')
    const cod_cli = nextId()
    db.propietarios.set(String(cod_cli), { ...b, cod_cli: String(cod_cli) })
    res.status(201).json({ cod_cli, codigo: 201, mensaje: `Propietario creado y vinculado a la propiedad con cod_ofer ${b.cod_ofer}` })
  })
  router.put('/propietarios/', (req, res) => {
    const b = req.body || {}
    const existing = db.propietarios.get(String(b.cod_cli))
    if (!existing) return err(res, 406, 406006, `Código ${b.cod_cli} no existe`)
    db.propietarios.set(String(b.cod_cli), { ...existing, ...b })
    res.status(202).json({ cod_cli: Number(b.cod_cli), codigo: 202, mensaje: 'Propietario actualizado' })
  })

  router.use((_req, res) => err(res, 405, 405001, 'Método no permitido'))
  return { router, db }
}
