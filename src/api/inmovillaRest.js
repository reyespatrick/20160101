/**
 * Browser client for Inmovilla's REST API v1, called through the stateless relay
 * at /api/rest/*. The user's session goes in the Authorization header; the relay adds
 * the agency's Inmovilla token, which never reaches the browser.
 *
 * Rate limits (per the docs): enums 2/min, clientes 20/min, propiedades 10/min,
 * propietarios 20/min. A 408 means "too many requests"; callers keep the record
 * pending and retry later.
 */
import { ApiError } from './inmovilla'
import { authHeader, reportUnauthorized } from './session'
import { PATHS, clientsFromSearch, errorMessage, extractCodCli, fromInmovillaClient, toInmovillaClient, toInmovillaOwner, toInmovillaProperty } from './inmovillaMapping'

export async function restRequest(path, { method = 'GET', json, query } = {}) {
  const qs = query
    ? '?' +
      Object.entries(query)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => (v === true ? encodeURIComponent(k) : `${encodeURIComponent(k)}=${encodeURIComponent(v)}`))
        .join('&')
    : ''
  let res
  try {
    res = await fetch(`/api/rest${path}${qs}`, {
      method,
      headers: { ...authHeader(), Accept: 'application/json', 'Content-Type': 'application/json' },
      body: json !== undefined ? JSON.stringify(json) : undefined,
    })
  } catch {
    throw new ApiError('Sin conexión con el servidor', 0)
  }
  const raw = await res.text()
  let body = null
  try {
    body = raw ? JSON.parse(raw) : null
  } catch {
    body = raw
  }
  if (!res.ok) {
    const err = Object.assign(new ApiError(errorMessage(body, res.status), res.status), { code: body?.code })
    reportUnauthorized(err)
    throw err
  }
  return body
}

export const isRateLimited = (err) => err?.status === 408
/** Inmovilla rejected the agency's key (401/403 without a relay code) — an admin must fix it. */
export const isAuthError = (err) => (err?.status === 401 || err?.status === 403) && !err?.code
/** The relay refused: session gone, role not allowed, or keys not configured. */
export const isRelayError = (err) => Boolean(err?.code)



// ---- enums ----
export const enumsTipos = (name) => restRequest(PATHS.enums, { query: { tipos: name || true } })
export const enumsCiudades = (pais) => restRequest(PATHS.enums, { query: { ciudades: pais || true } })
export const enumsZonas = (keyLoca) => restRequest(PATHS.enums, { query: { zonas: String(keyLoca) } })

// ---- clients ----
export async function getClient(codCli) {
  return fromInmovillaClient(await restRequest(PATHS.clients, { query: { cod_cli: codCli } }))
}
/**
 * Look a contact up by phone or email.
 *
 * The number is normalised the way we write it, and when that finds nobody the raw digits are
 * tried once: a contact typed into Inmovilla's own screens may carry its country code inside the
 * number field, where our normalised key would never match it. Two requests at worst, and only
 * when the first came back empty.
 */
export async function searchClients({ telefono, email }) {
  const ask = async (query) => {
    try {
      return clientsFromSearch(await restRequest(PATHS.clientSearch, { query }))
    } catch (err) {
      if (err.status === 404) return []
      throw err
    }
  }
  if (!telefono) return ask({ telefono, email })
  const key = phoneKey(telefono)
  const raw = digitsOf(telefono)
  const found = await ask({ telefono: key || raw, email })
  if (found.length || !key || key === raw) return found
  return ask({ telefono: raw, email })
}
export async function createClient(client) {
  return extractCodCli(await restRequest(PATHS.clients, { method: 'POST', json: toInmovillaClient(client) }))
}
export async function updateClient(client) {
  await restRequest(PATHS.clients, { method: 'PUT', json: toInmovillaClient(client, { forUpdate: true }) })
  return client.remoteId
}
export function deleteClient(codCli) {
  return restRequest(`${PATHS.clients}${encodeURIComponent(codCli)}`, { method: 'DELETE' })
}

// ---- properties ----
/** Create or update (Inmovilla matches on `ref`). Returns the raw response ({codigo, mensaje}). */
export function saveProperty(property, photoUrls) {
  return restRequest(PATHS.properties, { method: 'POST', json: toInmovillaProperty(property, photoUrls) })
}
export async function getPropertyByRef(ref) {
  try {
    return await restRequest(PATHS.properties, { query: { ref } })
  } catch (err) {
    if (err.status === 404) return null
    throw err
  }
}

// ---- owners ----
export async function createOwner(property) {
  return extractCodCli(await restRequest(PATHS.owners, { method: 'POST', json: toInmovillaOwner(property) }))
}
export async function updateOwner(property) {
  await restRequest(PATHS.owners, { method: 'PUT', json: toInmovillaOwner(property, { forUpdate: true }) })
  return property.ownerRemoteId
}

// ---- photo hosting on the relay (Inmovilla fetches photos from public URLs) ----
export async function hostPhoto(blob) {
  let res
  try {
    res = await fetch('/api/photos', { method: 'PUT', headers: { ...authHeader(), 'Content-Type': blob.type || 'image/jpeg' }, body: blob })
  } catch {
    throw new ApiError('Sin conexión con el servidor', 0)
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = Object.assign(new ApiError(body.error || `Error ${res.status}`, res.status), { code: body.code })
    reportUnauthorized(err)
    throw err
  }
  return body.url
}

// ---- follow-ups (seguimientos) ----
import { extractCodSeg, toInmovillaDay, toInmovillaFollowUp } from './inmovillaMapping'

export const enumsTiposSeguimiento = () => restRequest(PATHS.enums, { query: { tiposeguimiento: true } })

/** Create (no codseg) or update (with codseg). Returns the codseg. */
export async function saveFollowUp(followUp) {
  const body = await restRequest(PATHS.followUps, { method: 'POST', json: toInmovillaFollowUp(followUp) })
  return extractCodSeg(body) || followUp.remoteId || null
}
export function getFollowUp(codseg) {
  return restRequest(PATHS.followUps, { query: { codseg } })
}
/** Follow-ups created between two dates (inclusive). */
export async function searchFollowUps({ from, to }) {
  try {
    const body = await restRequest(PATHS.followUpSearch, { query: { fechaalta_desde: toInmovillaDay(from), fechaalta_hasta: toInmovillaDay(to) } })
    return Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : []
  } catch (err) {
    if (err.status === 404) return []
    throw err
  }
}

// ---- owners (propietarios), full records ----
import { fromInmovillaOwner, toInmovillaOwnerRecord } from './inmovillaMapping'
import { digitsOf, phoneKey } from '../models/client'

async function ownerQuery(query) {
  try {
    return fromInmovillaOwner(await restRequest(PATHS.owners, { query }))
  } catch (err) {
    if (err.status === 404) return null
    throw err
  }
}
export const getOwnerByCodOfer = (codOfer) => ownerQuery({ cod_ofer: codOfer })
export const getOwnerByCodCli = (codCli) => ownerQuery({ cod_cli: codCli })
export async function createOwnerRecord(owner) {
  return extractCodCli(await restRequest(PATHS.owners, { method: 'POST', json: toInmovillaOwnerRecord(owner) }))
}
export async function updateOwnerRecord(owner) {
  await restRequest(PATHS.owners, { method: 'PUT', json: toInmovillaOwnerRecord(owner, { forUpdate: true }) })
  return owner.remoteId
}
export function deleteOwner(codCli) {
  return restRequest(`${PATHS.owners}${encodeURIComponent(codCli)}`, { method: 'DELETE' })
}
