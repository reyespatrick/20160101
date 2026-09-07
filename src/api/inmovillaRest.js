/**
 * Browser client for Inmovilla's REST API v1, called through the stateless relay
 * at /api/rest/*. The user's token travels in the X-Inmovilla-Token header and
 * lives only in the browser.
 *
 * Rate limits (per the docs): enums 2/min, clientes 20/min, propiedades 10/min,
 * propietarios 20/min. A 408 means "too many requests"; callers keep the record
 * pending and retry later.
 */
import { ApiError } from './inmovilla'
import { PATHS, clientsFromSearch, errorMessage, extractCodCli, fromInmovillaClient, toInmovillaClient, toInmovillaOwner, toInmovillaProperty } from './inmovillaMapping'

export async function restRequest(token, path, { method = 'GET', json, query } = {}) {
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
      headers: { 'X-Inmovilla-Token': token, Accept: 'application/json', 'Content-Type': 'application/json' },
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
  if (!res.ok) throw new ApiError(errorMessage(body, res.status), res.status)
  return body
}

export const isRateLimited = (err) => err?.status === 408
export const isAuthError = (err) => err?.status === 401 || err?.status === 403

/** Login check: a harmless search. 404 (no match) proves the token is accepted. */
export async function verifyToken(token) {
  try {
    await restRequest(token, PATHS.clientSearch, { query: { telefono: '000000000' } })
  } catch (err) {
    if (isAuthError(err)) throw err
    if (err.status === 0) throw err
  }
  return true
}

// ---- enums ----
export const enumsTipos = (token, name) => restRequest(token, PATHS.enums, { query: { tipos: name || true } })
export const enumsCiudades = (token, pais) => restRequest(token, PATHS.enums, { query: { ciudades: pais || true } })
export const enumsZonas = (token, keyLoca) => restRequest(token, PATHS.enums, { query: { zonas: String(keyLoca) } })

// ---- clients ----
export async function getClient(token, codCli) {
  return fromInmovillaClient(await restRequest(token, PATHS.clients, { query: { cod_cli: codCli } }))
}
export async function searchClients(token, { telefono, email }) {
  try {
    return clientsFromSearch(await restRequest(token, PATHS.clientSearch, { query: { telefono, email } }))
  } catch (err) {
    if (err.status === 404) return []
    throw err
  }
}
export async function createClient(token, client) {
  return extractCodCli(await restRequest(token, PATHS.clients, { method: 'POST', json: toInmovillaClient(client) }))
}
export async function updateClient(token, client) {
  await restRequest(token, PATHS.clients, { method: 'PUT', json: toInmovillaClient(client, { forUpdate: true }) })
  return client.remoteId
}
export function deleteClient(token, codCli) {
  return restRequest(token, `${PATHS.clients}${encodeURIComponent(codCli)}`, { method: 'DELETE' })
}

// ---- properties ----
/** Create or update (Inmovilla matches on `ref`). Returns the raw response ({codigo, mensaje}). */
export function saveProperty(token, property, photoUrls) {
  return restRequest(token, PATHS.properties, { method: 'POST', json: toInmovillaProperty(property, photoUrls) })
}
export async function getPropertyByRef(token, ref) {
  try {
    return await restRequest(token, PATHS.properties, { query: { ref } })
  } catch (err) {
    if (err.status === 404) return null
    throw err
  }
}

// ---- owners ----
export async function createOwner(token, property) {
  return extractCodCli(await restRequest(token, PATHS.owners, { method: 'POST', json: toInmovillaOwner(property) }))
}
export async function updateOwner(token, property) {
  await restRequest(token, PATHS.owners, { method: 'PUT', json: toInmovillaOwner(property, { forUpdate: true }) })
  return property.ownerRemoteId
}

// ---- photo hosting on the relay (Inmovilla fetches photos from public URLs) ----
export async function hostPhoto(token, blob) {
  let res
  try {
    res = await fetch('/api/photos', { method: 'PUT', headers: { 'X-Inmovilla-Token': token, 'Content-Type': blob.type || 'image/jpeg' }, body: blob })
  } catch {
    throw new ApiError('Sin conexión con el servidor', 0)
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(body.error || `Error ${res.status}`, res.status)
  return body.url
}

// ---- follow-ups (seguimientos) ----
import { extractCodSeg, toInmovillaDay, toInmovillaFollowUp } from './inmovillaMapping'

export const enumsTiposSeguimiento = (token) => restRequest(token, PATHS.enums, { query: { tiposeguimiento: true } })

/** Create (no codseg) or update (with codseg). Returns the codseg. */
export async function saveFollowUp(token, followUp) {
  const body = await restRequest(token, PATHS.followUps, { method: 'POST', json: toInmovillaFollowUp(followUp) })
  return extractCodSeg(body) || followUp.remoteId || null
}
export function getFollowUp(token, codseg) {
  return restRequest(token, PATHS.followUps, { query: { codseg } })
}
/** Follow-ups created between two dates (inclusive). */
export async function searchFollowUps(token, { from, to }) {
  try {
    const body = await restRequest(token, PATHS.followUpSearch, { query: { fechaalta_desde: toInmovillaDay(from), fechaalta_hasta: toInmovillaDay(to) } })
    return Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : []
  } catch (err) {
    if (err.status === 404) return []
    throw err
  }
}

// ---- owners (propietarios), full records ----
import { fromInmovillaOwner, toInmovillaOwnerRecord } from './inmovillaMapping'

async function ownerQuery(token, query) {
  try {
    return fromInmovillaOwner(await restRequest(token, PATHS.owners, { query }))
  } catch (err) {
    if (err.status === 404) return null
    throw err
  }
}
export const getOwnerByCodOfer = (token, codOfer) => ownerQuery(token, { cod_ofer: codOfer })
export const getOwnerByCodCli = (token, codCli) => ownerQuery(token, { cod_cli: codCli })
export async function createOwnerRecord(token, owner) {
  return extractCodCli(await restRequest(token, PATHS.owners, { method: 'POST', json: toInmovillaOwnerRecord(owner) }))
}
export async function updateOwnerRecord(token, owner) {
  await restRequest(token, PATHS.owners, { method: 'PUT', json: toInmovillaOwnerRecord(owner, { forUpdate: true }) })
  return owner.remoteId
}
export function deleteOwner(token, codCli) {
  return restRequest(token, `${PATHS.owners}${encodeURIComponent(codCli)}`, { method: 'DELETE' })
}
