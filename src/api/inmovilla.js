/**
 * Browser side client. All calls go through our proxy (/api/inmovilla), which
 * forwards them to Inmovilla. The proxy is required because Inmovilla has no
 * CORS headers and only accepts requests from whitelisted server IPs.
 */

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

/**
 * @param {{numagencia:string,password:string,idioma:number}} credentials
 * @param {Array<{type:string,pos?:number,num?:number,where?:string,order?:string}>} requests
 */
export async function callInmovilla(credentials, requests) {
  let res
  try {
    res = await fetch('/api/inmovilla', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...credentials, requests }),
    })
  } catch {
    throw new ApiError('No hay conexión con el servidor', 0)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new ApiError(data.error || `Error ${res.status}`, res.status)
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
  { value: 'fechaact desc', label: 'Más recientes' },
  { value: 'precioinmo asc', label: 'Precio: menor a mayor' },
  { value: 'precioinmo desc', label: 'Precio: mayor a menor' },
  { value: 'ref asc', label: 'Referencia' },
]

export async function fetchProperties(credentials, { page = 1, pageSize = 20, where = '', order = 'fechaact desc' } = {}) {
  const pos = (page - 1) * pageSize + 1
  const data = await callInmovilla(credentials, [{ type: 'paginacion', pos, num: pageSize, where, order }])
  const list = splitSection(data.paginacion)
  const types = splitSection(data.lostipos).items
  return { ...list, types }
}

export async function fetchProperty(credentials, codOfer) {
  const data = await callInmovilla(credentials, [
    { type: 'ficha', pos: 1, num: 1, where: `cod_ofer=${Number(codOfer)}`, order: '' },
  ])
  const { items } = splitSection(data.ficha)
  return items[0] || null
}
