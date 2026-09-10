/**
 * A fake Inmovilla served next to the application, so a deployment can be exercised end to
 * end — including every write — without touching a real agency.
 *
 * It is a genuine upstream, not a branch inside the app: the functions still call whatever
 * INMOVILLA_API_URL and INMOVILLA_REST_URL point at, so the code path a demo exercises is
 * exactly the one production takes. Point those two variables here to get a demo instance.
 *
 *   POST /api/_mock/apiweb      the apiweb form endpoint (listing, ficha, enums)
 *   ANY  /api/_mock/rest/*      REST v1: clientes, propiedades, propietarios, seguimientos
 *
 * State lives in the isolate's memory, so records created here fade when Cloudflare recycles
 * it. That is deliberate and harmless: the app is offline-first and shows what it holds on the
 * device, so a created client or listing stays visible to the person who created it.
 */
import { CITIES, CITY_KEY_BASE, TYPES, ZONES, mockResponse, upsertMockProperty, zoneKey } from '../../../server/mock.js'

const TOKEN = 'demo-token'

const ENUMS = {
  keyacci: [{ nombre: 'Vender', valor: 1 }, { nombre: 'Alquilar', valor: 2 }],
  key_tipo: TYPES.map(([valor, nombre]) => ({ nombre, valor })),
  conservacion: [{ nombre: 'Obra nueva', valor: 1 }, { nombre: 'Buen estado', valor: 2 }, { nombre: 'A reformar', valor: 3 }, { nombre: 'Reformado', valor: 4 }],
  keyori: ['Norte', 'Sur', 'Este', 'Oeste', 'Noreste', 'Noroeste', 'Sureste', 'Suroeste'].map((nombre, i) => ({ nombre, valor: i + 1 })),
  eninternet: [{ nombre: 'No publicar', valor: 0 }, { nombre: 'Web', valor: 1 }, { nombre: 'Web y portales', valor: 2 }],
  estadoficha: [{ nombre: 'Disponible', valor: 1 }, { nombre: 'Reservado', valor: 2 }, { nombre: 'Vendido', valor: 3 }],
  tiposeguimiento: [
    { nombre: 'Llamada', valor: 1 }, { nombre: 'Visita', valor: 2 },
    { nombre: 'Email', valor: 3 }, { nombre: 'Nota', valor: 4 },
  ],
}

// Per-isolate store. Seeded with a few contacts so the screens are never empty on a fresh open.
const store = {
  clientes: new Map(),
  propietarios: new Map(),
  seguimientos: new Map(),
  next: 5000,
}
const nextId = () => store.next++

function seed() {
  if (store.clientes.size) return
  for (const c of [
    { nombre: 'Lucía', apellidos: 'Fernández', prefijotel2: 34, telefono2: 600111222, email: 'lucia@example.es' },
    { nombre: 'Javier', apellidos: 'Moreno', prefijotel2: 34, telefono2: 600333444, email: 'javier@example.es' },
    { nombre: 'Marta', apellidos: 'Sanz', prefijotel2: 34, telefono2: 600555666, email: 'marta@example.es' },
  ]) {
    const cod = nextId()
    store.clientes.set(cod, { cod_cli: cod, ...c })
  }
}

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
const fail = (status, codigo, mensaje) => json({ codigo, mensaje }, status)
const num = (v) => (v === undefined || v === null || v === '' ? undefined : Number(v))

/** `2;clave;1;lostipos;paginacion;1;20;;` → credentials + query descriptors */
function parseParam(param) {
  const parts = String(param || '').split(';')
  const requests = []
  for (let i = 4; i < parts.length; i += 5) {
    if (!parts[i]) break
    requests.push({ type: parts[i], pos: Number(parts[i + 1]) || 1, num: Number(parts[i + 2]) || 20, where: parts[i + 3] || '', order: parts[i + 4] || '' })
  }
  return { numagencia: parts[0], password: parts[1], requests }
}

async function apiweb(request) {
  const form = new URLSearchParams(await request.text())
  if (!form.get('ia')) return new Response('NECESITAMOS RECIBIR LA IP', { status: 200 })
  const { numagencia, password, requests } = parseParam(form.get('param'))
  if (!requests.length) return json({ error: 'Sin consultas' })
  return json(mockResponse({ numagencia, password }, requests))
}

// ---------------------------------------------------------------------------
// REST v1
// ---------------------------------------------------------------------------
async function rest(request, path, query) {
  const method = request.method.toUpperCase()
  if ((request.headers.get('token') || request.headers.get('x-inmovilla-token')) !== TOKEN) {
    return fail(401, 401001, 'Token no válido (modo demo: usa "demo-token")')
  }
  const body = method === 'GET' || method === 'DELETE' ? {} : await request.json().catch(() => ({}))
  seed()

  // ---- enums ----
  if (path === '/enums/') {
    if (query.has('tipos')) {
      const name = query.get('tipos')
      if (name && name !== 'true') return ENUMS[name] ? json({ [name]: ENUMS[name] }) : fail(404, 404001, 'No existe el tipo')
      return json(ENUMS)
    }
    if (query.has('ciudades')) {
      return json([{ pais: 724, provincia: 'ALICANTE', cod_prov: 4, ciudades: CITIES.map((ciudad, i) => ({ ciudad, key_loca: CITY_KEY_BASE + i })) }])
    }
    if (query.has('zonas')) {
      const keys = String(query.get('zonas')).split(',').map((k) => Number(k.trim()))
      if (keys.some((k) => !Number.isFinite(k))) return fail(400, 400005, "key_loca incorrecto (debe ser númerico y separado por ',')")
      return json(keys.map((key) => ({ key_loca: key, zonas: ZONES.map((zona, i) => ({ zona, key_zona: zoneKey(key, i) })) })))
    }
    if (query.has('tiposeguimiento')) return json({ tiposeguimiento: ENUMS.tiposeguimiento })
    return fail(400, 400001, 'Falta el parámetro')
  }

  // ---- clientes ----
  if (path === '/clientes/buscar/') {
    const phone = num(query.get('telefono'))
    const email = (query.get('email') || '').toLowerCase()
    if (phone === undefined && !email) return fail(400, 400001, 'Indica telefono o email')
    const found = [...store.clientes.values()].filter(
      (c) => (phone !== undefined && [c.telefono1, c.telefono2, c.telefono3].some((t) => Number(t) === phone)) || (email && String(c.email || '').toLowerCase() === email),
    )
    return found.length ? json(found) : fail(404, 404001, 'No encontrado')
  }

  if (path.startsWith('/clientes/')) {
    const tail = path.slice('/clientes/'.length).replace(/\/$/, '')
    if (method === 'GET') {
      const cod = num(query.get('cod_cli'))
      const found = cod !== undefined ? store.clientes.get(cod) : null
      return found ? json(found) : fail(404, 404001, 'No encontrado')
    }
    if (method === 'POST') {
      if (!String(body.nombre || '').trim()) return fail(406, 406001, 'Campo nombre obligatorio')
      for (const f of ['telefono1', 'telefono2', 'telefono3']) {
        if (body[f] !== undefined && !Number.isFinite(Number(body[f]))) return fail(406, 406002, `Campo ${f} no válido`)
      }
      const cod = nextId()
      store.clientes.set(cod, { cod_cli: cod, ...body })
      return json({ cod_cli: cod, codigo: 201, mensaje: 'Cliente creado' }, 201)
    }
    if (method === 'PUT') {
      const cod = num(body.cod_cli)
      if (!store.clientes.has(cod)) return fail(404, 404001, 'No encontrado')
      store.clientes.set(cod, { ...store.clientes.get(cod), ...body })
      return json({ cod_cli: cod, codigo: 200, mensaje: 'Cliente modificado' })
    }
    if (method === 'DELETE') {
      const cod = num(tail)
      if (!store.clientes.delete(cod)) return fail(404, 404001, 'No encontrado')
      return json({ codigo: 200, mensaje: 'Cliente eliminado' })
    }
  }

  // ---- propiedades ----
  if (path === '/propiedades/') {
    if (method === 'POST') {
      if (!String(body.ref || '').trim()) return fail(406, 406001, 'Campo ref obligatorio')
      if (!body.keyacci || !body.key_tipo || !body.key_loca) return fail(406, 406001, 'Faltan keyacci, key_tipo o key_loca')
      const record = upsertMockProperty({ ...body, cod_ofer: body.cod_ofer || nextId() })
      return json({ cod_ofer: record.cod_ofer, ref: record.ref, codigo: 201, mensaje: 'Propiedad guardada' }, 201)
    }
    return fail(405, 405001, 'Método no permitido')
  }

  // ---- propietarios ----
  if (path === '/propietarios/') {
    if (method === 'GET') {
      const byOfer = num(query.get('cod_ofer'))
      const byCli = num(query.get('cod_cli'))
      const ref = query.get('ref')
      const found = [...store.propietarios.values()].find(
        (o) => (byOfer !== undefined && Number(o.cod_ofer) === byOfer) || (byCli !== undefined && Number(o.cod_cli) === byCli) || (ref && o.ref === ref),
      )
      return found ? json(found) : fail(404, 404001, 'No encontrado')
    }
    if (method === 'POST') {
      if (!num(body.cod_ofer)) return fail(406, 406001, 'Campo cod_ofer obligatorio')
      if (!String(body.nombre || '').trim()) return fail(406, 406001, 'Campo nombre obligatorio')
      const cod = nextId()
      store.propietarios.set(cod, { cod_cli: cod, ...body })
      return json({ cod_cli: cod, codigo: 201, mensaje: 'Propietario creado' }, 201)
    }
    if (method === 'PUT') {
      const cod = num(body.cod_cli)
      if (!store.propietarios.has(cod)) return fail(404, 404001, 'No encontrado')
      store.propietarios.set(cod, { ...store.propietarios.get(cod), ...body })
      return json({ cod_cli: cod, codigo: 200, mensaje: 'Propietario modificado' })
    }
  }
  if (path.startsWith('/propietarios/') && method === 'DELETE') {
    const cod = num(path.slice('/propietarios/'.length).replace(/\/$/, ''))
    if (!store.propietarios.delete(cod)) return fail(404, 404001, 'No encontrado')
    return json({ codigo: 200, mensaje: 'Propietario eliminado' })
  }

  // ---- seguimientos ----
  if (path === '/seguimientos/search/') {
    const from = query.get('fechaalta_desde')
    const to = query.get('fechaalta_hasta')
    if (!from || !to) return fail(400, 400001, 'Indica fechaalta_desde y fechaalta_hasta')
    const found = [...store.seguimientos.values()].filter((s) => String(s.fechaalta || '') >= from && String(s.fechaalta || '') <= `${to} 23:59:59`)
    return found.length ? json(found) : fail(404, 404001, 'No encontrado')
  }
  if (path === '/seguimientos/') {
    if (method === 'GET') {
      const cod = num(query.get('codseg'))
      const found = cod !== undefined ? store.seguimientos.get(cod) : null
      return found ? json(found) : fail(404, 404001, 'No encontrado')
    }
    if (method === 'POST') {
      const cod = num(body.codseg) || nextId()
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
      store.seguimientos.set(cod, { codseg: cod, fechaalta: now, ...body })
      return json({ codseg: cod, codigo: 201, mensaje: 'Seguimiento guardado' }, 201)
    }
  }

  return fail(404, 404001, 'Ruta desconocida en el mock')
}

export const onRequest = async (context) => {
  const url = new URL(context.request.url)
  // Read the path off the URL, not context.params: the router drops the trailing slash that
  // Inmovilla's routes carry ("/clientes/", "/enums/"), and every route below expects it.
  const base = '/api/_mock'
  const path = url.pathname.startsWith(base) ? url.pathname.slice(base.length) || '/' : '/'
  try {
    if (path === '/apiweb' || path === '/apiweb/') return await apiweb(context.request)
    if (path.startsWith('/rest')) return await rest(context.request, path.slice('/rest'.length) || '/', url.searchParams)
    return json({ ok: true, mock: 'inmovilla', endpoints: ['/api/_mock/apiweb', '/api/_mock/rest/*'] })
  } catch (err) {
    console.error('[mock]', err?.message)
    return fail(500, 500001, err?.message || 'Error en el mock')
  }
}
