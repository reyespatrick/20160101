/**
 * Browser client for Inmovilla's REST API v1, called through the stateless relay
 * at /api/rest/*. The user's token travels in the X-Inmovilla-Token header of
 * every request; it lives only in the user's browser storage.
 */
import { ApiError } from './inmovilla'
import { PATHS, extractId, extractList, toInmovillaClient, toInmovillaPhoto, toInmovillaProperty } from './inmovillaMapping'

export async function restRequest(token, path, { method = 'GET', json, query } = {}) {
  const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== '')).toString() : ''
  let res
  try {
    res = await fetch(`/api/rest${path}${qs}`, {
      method,
      headers: { 'X-Inmovilla-Token': token, Accept: 'application/json', ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: json !== undefined ? JSON.stringify(json) : undefined,
    })
  } catch {
    throw new ApiError('Sin conexión con el servidor', 0)
  }
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!res.ok) {
    const message = (body && typeof body === 'object' && (body.error || body.message || body.mensaje)) || (typeof body === 'string' && body.slice(0, 200)) || `Error ${res.status}`
    throw new ApiError(message, res.status)
  }
  return body
}

/** Cheap call used at login to check the token. */
export function verifyToken(token) {
  return restRequest(token, PATHS.clients, { query: { limit: 1 } })
}

// ---- clients ----
export async function listClients(token) {
  return extractList(await restRequest(token, PATHS.clients))
}
export async function createClient(token, client) {
  return extractId(await restRequest(token, PATHS.clients, { method: 'POST', json: toInmovillaClient(client) }))
}
export async function updateClient(token, remoteId, client) {
  await restRequest(token, `${PATHS.clients}/${encodeURIComponent(remoteId)}`, { method: 'PUT', json: toInmovillaClient(client) })
  return remoteId
}
export function deleteClient(token, remoteId) {
  return restRequest(token, `${PATHS.clients}/${encodeURIComponent(remoteId)}`, { method: 'DELETE' })
}

// ---- properties ----
export async function createProperty(token, property) {
  return extractId(await restRequest(token, PATHS.properties, { method: 'POST', json: toInmovillaProperty(property) }))
}
export async function updateProperty(token, remoteId, property) {
  await restRequest(token, `${PATHS.properties}/${encodeURIComponent(remoteId)}`, { method: 'PUT', json: toInmovillaProperty(property) })
  return remoteId
}
export function deleteProperty(token, remoteId) {
  return restRequest(token, `${PATHS.properties}/${encodeURIComponent(remoteId)}`, { method: 'DELETE' })
}
export async function uploadPhoto(token, remoteId, blob, opts) {
  const base64 = await blobToBase64(blob)
  return extractId(await restRequest(token, PATHS.photos(remoteId), { method: 'POST', json: toInmovillaPhoto(base64, opts) }))
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = () => reject(new Error('No se pudo leer la foto'))
    reader.readAsDataURL(blob)
  })
}
