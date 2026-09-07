/**
 * Mapping between the app's records and Inmovilla's REST API v1
 * (https://procesos.inmovilla.com/api/v1, documentation "API REST v.1 Inmovilla").
 */
import { FEATURES, NUMERIC_FEATURES } from '../models/property'
import { splitPhone } from '../models/client'

export const PATHS = {
  enums: '/enums/',
  clients: '/clientes/',
  clientSearch: '/clientes/buscar/',
  properties: '/propiedades/',
  owners: '/propietarios/',
}

const num = (v) => (v === null || v === undefined || v === '' ? undefined : Number(v))
const text = (v) => (v === null || v === undefined || String(v).trim() === '' ? undefined : String(v).trim())
const strip = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))

/** Error body → readable message ({codigo, mensaje} per the docs; be lenient). */
export function errorMessage(body, status) {
  if (body && typeof body === 'object') {
    const msg = body.mensaje || body.message || body.error || body.descripcion
    if (msg) return body.codigo ? `${msg} (${body.codigo})` : String(msg)
  }
  if (typeof body === 'string' && body.trim()) return body.trim().slice(0, 200)
  return status === 408 ? 'Inmovilla limita las peticiones; se reintentará en un momento' : `Error ${status}`
}

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** `/enums/?tipos` → { keyacci: [{nombre, valor}], ... } normalised to { name: [{ value, label }] } */
export function parseTipos(body) {
  const out = {}
  if (!body || typeof body !== 'object' || Array.isArray(body)) return out
  for (const [name, list] of Object.entries(body)) {
    if (!Array.isArray(list)) continue
    out[name] = list.map((o) => ({ value: o.valor ?? o.value, label: String(o.nombre ?? o.label ?? o.valor) })).filter((o) => o.value !== undefined)
  }
  return out
}

/** `/enums/?ciudades` → flat [{ key_loca, ciudad, provincia, cod_prov }] */
export function parseCiudades(body) {
  const out = []
  for (const prov of Array.isArray(body) ? body : []) {
    for (const c of prov.ciudades || []) {
      if (c.key_loca === undefined) continue
      out.push({ key_loca: Number(c.key_loca), ciudad: String(c.ciudad), provincia: String(prov.provincia || ''), cod_prov: prov.cod_prov })
    }
  }
  return out
}

/** `/enums/?zonas=31699` → { "31699": [{ key_zona, zona }] } (the docs' sample mixes key names; accept both) */
export function parseZonas(body) {
  const out = {}
  if (!body || typeof body !== 'object') return out
  for (const [keyLoca, list] of Object.entries(body)) {
    out[keyLoca] = (Array.isArray(list) ? list : [])
      .map((z) => ({ key_zona: Number(z.key_zona ?? z.key_loca), zona: String(z.zona ?? z.ciudad ?? '') }))
      .filter((z) => Number.isFinite(z.key_zona) && z.zona)
  }
  return out
}

// ---------------------------------------------------------------------------
// Clients (/clientes)
// ---------------------------------------------------------------------------

export function toInmovillaClient(c, { forUpdate = false } = {}) {
  const mobile = splitPhone(c.mobile)
  const phone = splitPhone(c.phone)
  return strip({
    cod_cli: forUpdate ? num(c.remoteId) : undefined,
    nombre: text(c.name),
    apellidos: text(c.surname),
    nif: text(c.nif),
    email: text(c.email),
    telefono1: phone.number ?? undefined,
    prefijotel1: phone.prefix ?? undefined,
    telefono2: mobile.number ?? undefined,
    prefijotel2: mobile.prefix ?? undefined,
    calle: text(c.street),
    numero: text(c.number),
    cp: text(c.postalCode),
    localidad: text(c.city),
    provincia: text(c.province),
    observacion: text(c.notes),
  })
}

function joinPhone(prefix, number) {
  if (number === undefined || number === null || number === '' || Number(number) === 0) return ''
  return prefix && Number(prefix) !== 34 ? `+${prefix} ${number}` : String(number)
}

/** Inmovilla client → app client. */
export function fromInmovillaClient(raw) {
  const codCli = raw?.cod_cli
  if (codCli === undefined || codCli === null || codCli === '') return null
  const remoteId = String(codCli)
  const ts = Date.parse(String(raw.altacliente || '').replace(' ', 'T')) || Date.now()
  return {
    id: `inmo-${remoteId}`,
    remoteId,
    name: String(raw.nombre ?? ''),
    surname: String(raw.apellidos ?? ''),
    nif: String(raw.nif ?? ''),
    email: String(raw.email ?? ''),
    phone: joinPhone(raw.prefijotel1, raw.telefono1),
    mobile: joinPhone(raw.prefijotel2, raw.telefono2),
    street: String(raw.calle ?? ''),
    number: String(raw.numero ?? ''),
    postalCode: String(raw.cp ?? ''),
    city: String(raw.localidad ?? ''),
    province: String(raw.provincia ?? ''),
    notes: String(raw.observacion ?? ''),
    agentName: raw.agente ? [raw.agente.nombre, raw.agente.apellidos].filter(Boolean).join(' ') : '',
    createdAt: ts,
    updatedAt: ts,
    deleted: false,
  }
}

/** The search endpoint may answer with one object or a list. */
export function clientsFromSearch(body) {
  const list = Array.isArray(body) ? body : body && typeof body === 'object' && body.cod_cli ? [body] : Array.isArray(body?.data) ? body.data : []
  return list.map(fromInmovillaClient).filter(Boolean)
}

// ---------------------------------------------------------------------------
// Properties (/propiedades) — POST creates or updates by `ref`, all fields every time
// ---------------------------------------------------------------------------

/**
 * @param {object} p app listing
 * @param {string[]} photoUrls public URLs of the photos, in display order
 */
export function toInmovillaProperty(p, photoUrls = []) {
  const rent = Number(p.operation) === 2
  const payload = {
    ref: text(p.ref),
    keyacci: Number(p.operation) || 1,
    key_tipo: num(p.typeKey),
    key_loca: num(p.cityKey),
    key_zona: num(p.zoneKey),
    zona: p.zoneKey ? undefined : text(p.zoneName),
    prospecto: false,
    nodisponible: Boolean(p.unavailable),
    precioinmo: rent ? undefined : num(p.price),
    precioalq: rent ? num(p.priceRent) : undefined,
    tituloes: text(p.title),
    descripciones: text(p.description),
    calle: text(p.street),
    numero: text(p.number),
    cp: text(p.postalCode),
    habitaciones: num(p.bedrooms),
    banyos: num(p.bathrooms),
    m_cons: num(p.builtArea),
    m_utiles: num(p.usableArea),
    m_parcela: num(p.plotArea),
    planta: num(p.floor),
    antiguedad: num(p.yearBuilt),
    conservacion: num(p.conservation),
    keyori: num(p.orientation),
    energialetra: text(p.energyRating),
    eninternet: num(p.publish),
  }
  for (const [key] of FEATURES) {
    const on = Boolean(p.features?.[key])
    payload[key] = NUMERIC_FEATURES.has(key) ? (on ? 1 : 0) : on
  }
  if (photoUrls.length) {
    payload.fotos = {}
    photoUrls.forEach((url, i) => {
      payload.fotos[String(i + 1)] = { url, posicion: i + 1 }
    })
  }
  return strip(payload)
}

/** Owner (propietario) linked to a listing by cod_ofer. */
export function toInmovillaOwner(p, { forUpdate = false } = {}) {
  const phone = splitPhone(p.ownerPhone)
  return strip({
    cod_cli: forUpdate ? num(p.ownerRemoteId) : undefined,
    cod_ofer: forUpdate ? undefined : num(p.codOfer),
    nombre: text(p.ownerName),
    apellidos: text(p.ownerSurname),
    email: text(p.ownerEmail),
    telefono1: phone.number ?? undefined,
    prefijotel1: phone.prefix ?? undefined,
  })
}

export function extractCodCli(body) {
  const v = body?.cod_cli ?? body?.data?.cod_cli
  return v === undefined || v === null ? null : String(v)
}
