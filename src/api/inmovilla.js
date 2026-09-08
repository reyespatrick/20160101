/**
 * Browser side client. All calls go through the relay (/api/inmovilla) with the
 * user's session; the relay adds the agency's Inmovilla keys. The relay is required
 * because Inmovilla has no CORS headers and only accepts whitelisted server IPs.
 */
import { authHeader, reportUnauthorized } from './session'

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

let dataLanguage = 1
/** Inmovilla data language (1 es, 2 en, 4 fr…) sent with listing queries. */
export function setDataLanguage(idioma) {
  dataLanguage = Number(idioma) || 1
}

/**
 * @param {Array<{type:string,pos?:number,num?:number,where?:string,order?:string}>} requests
 */
export async function callInmovilla(requests) {
  let res
  try {
    res = await fetch('/api/inmovilla', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ requests, idioma: dataLanguage }),
    })
  } catch {
    throw new ApiError('No hay conexión con el servidor', 0)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = Object.assign(new ApiError(data.error || `Error ${res.status}`, res.status), { code: data.code })
    reportUnauthorized(err)
    throw err
  }
  return data
}

/** Split an Inmovilla section into pagination meta + items. */
export function splitSection(section) {
  if (!Array.isArray(section) || section.length === 0) {
    return { meta: { posicion: 1, elementos: 0, total: 0 }, items: [] }
  }
  const [meta, ...items] = section
  return {
    meta: {
      posicion: Number(meta?.posicion ?? 1),
      elementos: Number(meta?.elementos ?? items.length),
      total: Number(meta?.total ?? items.length),
    },
    items,
  }
}

/** Escape a value for use inside a SQL-ish where clause sent to Inmovilla. */
export function sqlString(value) {
  return `'${String(value).replace(/[';\\]/g, '')}'`
}

export function buildWhere({ operation, typeKey, search } = {}) {
  const parts = []
  if (operation === 'sale') parts.push('keyacci=1')
  if (operation === 'rent') parts.push('keyacci=2')
  if (typeKey) parts.push(`key_tipo=${Number(typeKey)}`)
  if (search && search.trim()) {
    const q = search.trim().replace(/[%';\\]/g, '')
    parts.push(`(ref like '%${q}%' or ciudad like '%${q}%')`)
  }
  return parts.join(' and ')
}

export const ORDER_OPTIONS = [
  { value: 'fechaact desc', labelKey: 'props.sortRecent' },
  { value: 'precioinmo asc', labelKey: 'props.sortPriceAsc' },
  { value: 'precioinmo desc', labelKey: 'props.sortPriceDesc' },
  { value: 'ref asc', labelKey: 'props.sortRef' },
]

export async function fetchProperties({ page = 1, pageSize = 20, where = '', order = 'fechaact desc' } = {}) {
  const pos = (page - 1) * pageSize + 1
  const data = await callInmovilla([{ type: 'paginacion', pos, num: pageSize, where, order }])
  const list = splitSection(data.paginacion)
  const types = splitSection(data.lostipos).items
  return { ...list, types }
}

export async function fetchProperty(codOfer) {
  const data = await callInmovilla([
    { type: 'ficha', pos: 1, num: 1, where: `cod_ofer=${Number(codOfer)}`, order: '' },
  ])
  const { items } = splitSection(data.ficha)
  return items[0] || null
}

/** Look a listing up by its public reference through apiweb. Returns the summary or null. */
export async function findByRef(ref) {
  const safe = String(ref).replace(/[%';\\]/g, '')
  if (!safe) return null
  const data = await callInmovilla([{ type: 'paginacion', pos: 1, num: 1, where: `ref=${sqlString(safe)}`, order: '' }])
  return splitSection(data.paginacion).items[0] || null
}
