/**
 * Sample data shaped like the Inmovilla API, used when INMOVILLA_MOCK=1.
 * Only the agency "1234" with key "demo" is accepted so the login flow can be tested.
 */
import { splitSection } from './inmovilla.js'

const CITIES = ['Alicante', 'Elche', 'Torrevieja', 'Benidorm', 'Altea', 'Dénia', 'Jávea', 'Calpe']
const ZONES = ['Centro', 'Playa', 'Casco antiguo', 'Urbanización', 'Norte', 'Sur']
const TYPES = [
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
    foto: `https://picsum.photos/seed/${photoSeed}/800/600`,
    latitud: 38.34 + r(),
    altitud: -0.48 + r(),
    nombreagente: 'Ana',
    apellidosagente: 'García',
    emailagente: 'ana@alma-demo.example',
    telefono1agente: 600000000 + i,
  }
}

const PROPERTIES = Array.from({ length: 57 }, (_, i) => makeProperty(i + 1))

function detailFor(p) {
  return {
    ...p,
    fotos: Array.from({ length: 5 }, (_, k) => `https://picsum.photos/seed/${100 + (p.cod_ofer - 10_000)}-${k}/1200/800`),
    descripciones: [
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
  return out
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
