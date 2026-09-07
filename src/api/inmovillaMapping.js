/**
 * Mapping between the app's records and Inmovilla's REST API v1.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │ TO CONFIRM against https://procesos.inmovilla.com/api/v1/apidoc/            │
 * │ Endpoint paths and field names below are our best reading of Inmovilla's   │
 * │ naming (they mirror the ficha fields of the read API). Adjust them here    │
 * │ and ONLY here once the documentation is available.                          │
 * └──────────────────────────────────────────────────────────────────────────────┘
 */

export const PATHS = {
  clients: '/clientes',
  properties: '/propiedades',
  photos: (propertyId) => `/propiedades/${encodeURIComponent(propertyId)}/fotos`,
}

const OPERATION_TO_KEYACCI = { sale: 1, rent: 2 }
const KEYACCI_TO_OPERATION = { 1: 'sale', 2: 'rent' }
const CONDITION_TO_CONSERVACION = { new: 1, good: 2, renovate: 3, renovated: 4 }
const CLIENT_OPERATION = { buy: 1, rent: 2, sell: 3, let: 4 }
const CLIENT_OPERATION_BACK = { 1: 'buy', 2: 'rent', 3: 'sell', 4: 'let' }

const num = (v) => (v === null || v === undefined || v === '' ? undefined : Number(v))
const strip = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))
const pick = (obj, ...keys) => {
  for (const k of keys) if (obj?.[k] !== undefined && obj?.[k] !== null && obj?.[k] !== '') return obj[k]
  return undefined
}

/** Id of a created/updated record, whatever shape Inmovilla answers with. */
export function extractId(body) {
  if (body === null || body === undefined) return null
  if (typeof body === 'number' || typeof body === 'string') return String(body)
  const found = [body.cod_ofer, body.id, body.codigo, body.cod_cliente, body.data?.cod_ofer, body.data?.id, body.data?.codigo].find(
    (v) => v !== undefined && v !== null && v !== '',
  )
  return found === undefined ? null : String(found)
}

/** Items of a list response: bare array, or wrapped in data/items/clientes/propiedades. */
export function extractList(body) {
  if (Array.isArray(body)) return body
  if (!body || typeof body !== 'object') return []
  for (const key of ['data', 'items', 'clientes', 'propiedades', 'results']) if (Array.isArray(body[key])) return body[key]
  return []
}

// ---- clients ----
export function toInmovillaClient(c) {
  return strip({
    nombre: c.name || undefined,
    apellidos: c.surname || undefined,
    telefono: c.phone || undefined,
    email: c.email || undefined,
    tipo: c.type || undefined,
    estado: c.status || undefined,
    keyacci: CLIENT_OPERATION[c.operation],
    tipos: c.propertyTypes?.length ? c.propertyTypes.join(', ') : undefined,
    zonas: c.zones?.length ? c.zones.join(', ') : undefined,
    preciomin: num(c.budgetMin),
    preciomax: num(c.budgetMax),
    habitaciones: num(c.bedrooms),
    observaciones: c.notes || undefined,
  })
}

/** Inmovilla client → app client (remoteId set, local id derived from it). */
export function fromInmovillaClient(raw) {
  const remoteId = extractId(raw)
  if (!remoteId) return null
  const split = (v) => (typeof v === 'string' ? v.split(/\s*,\s*/).filter(Boolean) : Array.isArray(v) ? v : [])
  const ts = Date.parse(pick(raw, 'fechamodificacion', 'fechaact', 'updated_at', 'fechaalta', 'fecha') || '') || 0
  return {
    id: `inmo-${remoteId}`,
    remoteId,
    name: String(pick(raw, 'nombre', 'name') ?? ''),
    surname: String(pick(raw, 'apellidos', 'surname') ?? ''),
    phone: String(pick(raw, 'telefono', 'telefono1', 'phone') ?? ''),
    email: String(pick(raw, 'email') ?? ''),
    type: String(pick(raw, 'tipo', 'type') ?? 'buyer'),
    status: String(pick(raw, 'estado', 'status') ?? 'new'),
    operation: CLIENT_OPERATION_BACK[pick(raw, 'keyacci')] || '',
    propertyTypes: split(pick(raw, 'tipos')),
    zones: split(pick(raw, 'zonas')),
    budgetMin: num(pick(raw, 'preciomin')) ?? null,
    budgetMax: num(pick(raw, 'preciomax')) ?? null,
    bedrooms: num(pick(raw, 'habitaciones')) ?? null,
    notes: String(pick(raw, 'observaciones', 'notas') ?? ''),
    properties: [],
    createdAt: Date.parse(pick(raw, 'fechaalta', 'fecha', 'created_at') || '') || ts,
    updatedAt: ts,
    deleted: false,
  }
}

// ---- properties ----
export function toInmovillaProperty(p) {
  const payload = {
    ref: p.ref || undefined,
    keyacci: OPERATION_TO_KEYACCI[p.operation] || 1,
    nbtipo: p.type || undefined,
    precioinmo: p.operation === 'rent' ? undefined : num(p.price),
    precioalq: p.operation === 'rent' ? num(p.priceRent) : undefined,
    titulo: p.title || undefined,
    descripcion: p.description || undefined,
    ciudad: p.city || undefined,
    zona: p.zone || undefined,
    provincia: p.province || undefined,
    cp: p.postalCode || undefined,
    direccion: p.address || undefined,
    habitaciones: num(p.bedrooms),
    banyos: num(p.bathrooms),
    m_cons: num(p.builtArea),
    m_uties: num(p.usableArea),
    m_parcela: num(p.plotArea),
    planta: p.floor || undefined,
    antiguedad: p.yearBuilt ? new Date().getFullYear() - Number(p.yearBuilt) : undefined,
    conservacion: CONDITION_TO_CONSERVACION[p.condition],
    energialetra: p.energyRating || undefined,
    nborientacion: p.orientation || undefined,
    propietario: p.ownerName || undefined,
    telefonopropietario: p.ownerPhone || undefined,
    observaciones: p.notes || undefined,
    eninternet: p.status === 'ready' || p.status === 'published' ? 1 : 0,
  }
  for (const [key, value] of Object.entries(p.features || {})) payload[key] = value ? 1 : 0
  return strip(payload)
}

export function operationFromKeyacci(v) {
  return KEYACCI_TO_OPERATION[v] || 'sale'
}

/** Photo upload body. Switch to multipart here if the documentation requires it. */
export function toInmovillaPhoto(base64, { order = 0, caption = '' } = {}) {
  return { orden: order, descripcion: caption, foto: base64, formato: 'jpg' }
}
