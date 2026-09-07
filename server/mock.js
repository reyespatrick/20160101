/**
 * Sample data shaped like the Inmovilla API, used when INMOVILLA_MOCK=1.
 * Only the agency "1234" with key "demo" is accepted so the login flow can be tested.
 */
import { splitSection } from './inmovilla.js'

export const CITIES = ['Alicante', 'Elche', 'Torrevieja', 'Benidorm', 'Altea', 'Dénia', 'Jávea', 'Calpe']
export const ZONES = ['Centro', 'Playa', 'Casco antiguo', 'Urbanización', 'Norte', 'Sur']
/** key_loca codes used by the mock REST enums: 31001.. in CITIES order */
export const CITY_KEY_BASE = 31001
/** key_zona codes: cityKey * 100 + index */
export const zoneKey = (cityKey, i) => Number(cityKey) * 100 + i
export const TYPES = [
  [1, 'Piso'],
  [2, 'Apartamento'],
  [3, 'Chalet'],
  [4, 'Adosado'],
  [5, 'Ático'],
  [6, 'Local comercial'],
  [7, 'Parcela'],
]

function rng(seed) {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

function makeProperty(i) {
  const r = rng(i + 17)
  const type = TYPES[Math.floor(r() * TYPES.length)]
  const rent = r() < 0.3
  const rooms = Math.floor(r() * 5)
  const price = rent ? 500 + Math.round(r() * 20) * 50 : 80_000 + Math.round(r() * 100) * 5_000
  const photoSeed = 100 + i
  return {
    cod_ofer: 10_000 + i,
    ref: `ALMA-${String(i).padStart(4, '0')}`,
    keyacci: rent ? 2 : 1,
    precioinmo: rent ? 0 : price,
    precioalq: rent ? price : 0,
    key_tipo: type[0],
    nbtipo: type[1],
    ciudad: CITIES[Math.floor(r() * CITIES.length)],
    zona: ZONES[Math.floor(r() * ZONES.length)],
    habitaciones: rooms,
    banyos: Math.max(1, Math.floor(rooms / 2)),
    m_cons: 45 + Math.round(r() * 30) * 5,
    m_parcela: type[1] === 'Chalet' || type[1] === 'Parcela' ? 300 + Math.round(r() * 20) * 50 : 0,
    ascensor: r() < 0.5 ? 1 : 0,
    piscina_com: r() < 0.4 ? 1 : 0,
    terraza: r() < 0.6 ? 1 : 0,
    plaza_gara: r() < 0.5 ? 1 : 0,
    aire_con: r() < 0.7 ? 1 : 0,
    destacado: r() < 0.2 ? 1 : 0,
    numfotos: 5,
    fechaact: `2026-0${1 + Math.floor(r() * 8)}-${String(1 + Math.floor(r() * 27)).padStart(2, '0')} 10:00:00`,
    foto: `/mock-photos/${(photoSeed % 12) + 1}.jpg`,
    latitud: 38.34 + r(),
    altitud: -0.48 + r(),
    nombreagente: 'Ana',
    apellidosagente: 'García',
    emailagente: 'ana@alma-demo.example',
    telefono1agente: 600000000 + i,
  }
}

const PROPERTIES = Array.from({ length: 57 }, (_, i) => makeProperty(i + 1))

/** Does a listing with this cod_ofer exist in the (mock) agency? Used by the mock REST for owner/follow-up links. */
export function mockPropertyExists(codOfer) {
  return PROPERTIES.some((p) => String(p.cod_ofer) === String(codOfer))
}

/**
 * Called by the mock REST when a listing is created/updated so it appears in the
 * apiweb listing like it would in the real Inmovilla.
 */
export function upsertMockProperty(rest) {
  const type = TYPES.find(([k]) => k === Number(rest.key_tipo)) || [0, 'Inmueble']
  const cityIdx = Number(rest.key_loca) - CITY_KEY_BASE
  const zoneIdx = rest.key_zona ? Number(rest.key_zona) % 100 : -1
  const fotos = Object.values(rest.fotos || {})
  const record = {
    cod_ofer: Number(rest.cod_ofer),
    ref: rest.ref,
    keyacci: Number(rest.keyacci) || 1,
    precioinmo: Number(rest.precioinmo) || 0,
    precioalq: Number(rest.precioalq) || 0,
    key_tipo: type[0],
    nbtipo: type[1],
    ciudad: CITIES[cityIdx] || String(rest.key_loca),
    zona: zoneIdx >= 0 ? ZONES[zoneIdx] || '' : rest.zona || '',
    habitaciones: Number(rest.habitaciones) || 0,
    banyos: Number(rest.banyos) || 0,
    m_cons: Number(rest.m_cons) || 0,
    m_parcela: Number(rest.m_parcela) || 0,
    ascensor: rest.ascensor ? 1 : 0,
    piscina_com: rest.piscina_com ? 1 : 0,
    terraza: rest.terraza ? 1 : 0,
    plaza_gara: Number(rest.plaza_gara) || 0,
    aire_con: rest.aire_con ? 1 : 0,
    destacado: 0,
    numfotos: fotos.length,
    fechaact: new Date().toISOString().slice(0, 19).replace('T', ' '),
    foto: fotos[0]?.url || '',
    fotos: fotos.map((f) => f.url),
    descripciones: [rest.descripciones || ''],
    nodisponible: rest.nodisponible ? 1 : 0,
  }
  const i = PROPERTIES.findIndex((p) => p.ref === rest.ref)
  if (i >= 0) PROPERTIES.splice(i, 1, { ...PROPERTIES[i], ...record })
  else PROPERTIES.unshift(record)
  return record
}

function detailFor(p) {
  return {
    ...p,
    fotos: p.fotos || Array.from({ length: 5 }, (_, k) => `/mock-photos/${((p.cod_ofer + k) % 12) + 1}.jpg`),
    descripciones: p.descripciones || [
      `${p.nbtipo} en ${p.ciudad}, zona ${p.zona}. ${p.habitaciones} dormitorios y ${p.banyos} baños en ${p.m_cons} m² construidos. ` +
        'Vivienda luminosa, lista para entrar a vivir, muy cerca de todos los servicios.',
    ],
    provincia: 'Alicante',
    cp: '03000',
    planta: 2,
    antiguedad: 15,
    nbconservacion: 'Buen estado',
    energialetra: 'E',
    agencia: 'ALMA Demo Inmobiliaria',
    telefono: '965 000 000',
    email: 'info@alma-demo.example',
  }
}

function applyWhere(list, where) {
  if (!where) return list
  let out = list
  const m = where.match(/keyacci\s*=\s*(\d)/)
  if (m) out = out.filter((p) => p.keyacci === Number(m[1]))
  const t = where.match(/key_tipo\s*=\s*(\d+)/)
  if (t) out = out.filter((p) => p.key_tipo === Number(t[1]))
  const like = where.match(/(?:ref|ciudad)\s+like\s+'%([^%']*)%'/i)
  if (like) {
    const q = like[1].toLowerCase()
    out = out.filter((p) => p.ref.toLowerCase().includes(q) || p.ciudad.toLowerCase().includes(q))
  }
  const cod = where.match(/cod_ofer\s*=\s*(\d+)/)
  if (cod) out = out.filter((p) => p.cod_ofer === Number(cod[1]))
  const ref = where.match(/(?:^|\s|\()ref\s*=\s*'([^']+)'/)
  if (ref) out = out.filter((p) => p.ref === ref[1])
  return out.filter((p) => !p.nodisponible)
}

function applyOrder(list, order) {
  if (!order) return list
  const [field, dir] = order.split(/\s+/)
  const sign = /desc/i.test(dir || '') ? -1 : 1
  return [...list].sort((a, b) => {
    const av = a[field] ?? 0
    const bv = b[field] ?? 0
    return av > bv ? sign : av < bv ? -sign : 0
  })
}

function paginate(list, pos, num) {
  const items = list.slice(pos - 1, pos - 1 + num)
  return [{ posicion: pos, elementos: items.length, total: list.length }, ...items]
}

export function mockResponse({ numagencia, password }, requests) {
  if (String(numagencia) !== '1234' || String(password) !== 'demo') {
    return { error: 'Agencia o clave API incorrecta (modo demo: agencia 1234 / clave demo)' }
  }
  const out = {
    lostipos: [{ posicion: 1, elementos: TYPES.length, total: TYPES.length }, ...TYPES.map(([key_tipo, nbtipo]) => ({ key_tipo, nbtipo }))],
  }
  for (const r of requests) {
    switch (r.type) {
      case 'paginacion':
        out.paginacion = paginate(applyOrder(applyWhere(PROPERTIES, r.where), r.order), r.pos, r.num)
        break
      case 'destacados':
        out.destacados = paginate(PROPERTIES.filter((p) => p.destacado), r.pos, r.num)
        break
      case 'ficha': {
        const found = applyWhere(PROPERTIES, r.where)
        out.ficha = paginate(found.map(detailFor), 1, 1)
        break
      }
      case 'ciudades': {
        const cities = CITIES.map((nombre, i) => ({ cod_ciu: i + 1, ciudad: nombre }))
        out.ciudades = paginate(cities, r.pos, r.num)
        break
      }
      default:
        out[r.type] = paginate([], 1, r.num)
    }
  }
  return out
}

export { splitSection }
