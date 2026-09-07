import { ApiError } from './inmovilla'

async function parse(res) {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(data.error || `Error ${res.status}`, res.status)
  return data
}

function offline() {
  return new ApiError('Sin conexión con el servidor', 0)
}

export async function syncProperties(token, { since, changes }) {
  let res
  try {
    res = await fetch('/api/properties/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ since, changes }),
    })
  } catch {
    throw offline()
  }
  return parse(res)
}

export async function uploadPhoto(token, propertyId, photoId, blob) {
  let res
  try {
    res = await fetch(`/api/properties/${encodeURIComponent(propertyId)}/photos/${encodeURIComponent(photoId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': blob.type || 'image/jpeg', Authorization: `Bearer ${token}` },
      body: blob,
    })
  } catch {
    throw offline()
  }
  return parse(res)
}

/** @returns {Promise<Blob|null>} null when the server does not have the file yet */
export async function downloadPhoto(token, propertyId, photoId) {
  let res
  try {
    res = await fetch(`/api/properties/${encodeURIComponent(propertyId)}/photos/${encodeURIComponent(photoId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    throw offline()
  }
  if (res.status === 404) return null
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new ApiError(data.error || `Error ${res.status}`, res.status)
  }
  return res.blob()
}
