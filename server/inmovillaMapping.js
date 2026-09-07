/**
 * Mapping between this app's records and Inmovilla's REST API v1.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │ TO CONFIRM against https://procesos.inmovilla.com/api/v1/apidoc/            │
 * │ The endpoint paths and payload field names below are our best reading of   │
 * │ Inmovilla's naming (they mirror the ficha fields of the read API). Adjust  │
 * │ them here and ONLY here once the documentation / token is available.       │
 * └──────────────────────────────────────────────────────────────────────────────┘
 *
 * Paths can also be overridden with environment variables without touching code:
 *   INMOVILLA_REST_PATH_PROPERTIES   (default /propiedades)
 *   INMOVILLA_REST_PATH_PHOTOS       (default /propiedades/{id}/fotos)
 *   INMOVILLA_REST_PATH_CLIENTS      (default /clientes)
 */

export const DEFAULT_PATHS = {
  properties: process.env.INMOVILLA_REST_PATH_PROPERTIES || '/propiedades',
  photos: process.env.INMOVILLA_REST_PATH_PHOTOS || '/propiedades/{id}/fotos',
  clients: process.env.INMOVILLA_REST_PATH_CLIENTS || '/clientes',
}

const OPERATION_TO_KEYACCI = { sale: 1, rent: 2 }
const CONDITION_TO_CONSERVACION = { new: 1, good: 2, renovate: 3, renovated: 4 }
const CLIENT_OPERATION = { buy: 1, rent: 2, sell: 3, let: 4 }

function cleanNumber(v) {
  return v === null || v === undefined || v === '' ? undefined : Number(v)
}

/** App listing → Inmovilla property payload. */
export function toInmovillaProperty(p) {
  const payload = {
    ref: p.ref || undefined,
    keyacci: OPERATION_TO_KEYACCI[p.operation] || 1,
    nbtipo: p.type || undefined,
    precioinmo: p.operation === 'rent' ? undefined : cleanNumber(p.price),
    precioalq: p.operation === 'rent' ? cleanNumber(p.priceRent) : undefined,
    titulo: p.title || undefined,
    descripcion: p.description || undefined,
    ciudad: p.city || undefined,
    zona: p.zone || undefined,
    provincia: p.province || undefined,
    cp: p.postalCode || undefined,
    direccion: p.address || undefined,
    habitaciones: cleanNumber(p.bedrooms),
    banyos: cleanNumber(p.bathrooms),
    m_cons: cleanNumber(p.builtArea),
    m_uties: cleanNumber(p.usableArea),
    m_parcela: cleanNumber(p.plotArea),
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
  return stripUndefined(payload)
}

/** App client → Inmovilla client/lead payload. */
export function toInmovillaClient(c) {
  return stripUndefined({
    nombre: c.name || undefined,
    apellidos: c.surname || undefined,
    telefono: c.phone || undefined,
    email: c.email || undefined,
    tipo: c.type || undefined,
    estado: c.status || undefined,
    keyacci: CLIENT_OPERATION[c.operation],
    tipos: c.propertyTypes?.length ? c.propertyTypes.join(', ') : undefined,
    zonas: c.zones?.length ? c.zones.join(', ') : undefined,
    preciomin: cleanNumber(c.budgetMin),
    preciomax: cleanNumber(c.budgetMax),
    habitaciones: cleanNumber(c.bedrooms),
    observaciones: c.notes || undefined,
  })
}

/** Pull the created/updated record id out of whatever shape Inmovilla answers with. */
export function extractRemoteId(body) {
  if (body === null || body === undefined) return null
  if (typeof body === 'number' || typeof body === 'string') return String(body)
  const candidates = [body.cod_ofer, body.id, body.codigo, body.cod_cliente, body.data?.cod_ofer, body.data?.id, body.data?.codigo]
  const found = candidates.find((v) => v !== undefined && v !== null && v !== '')
  return found === undefined ? null : String(found)
}

function stripUndefined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))
}
