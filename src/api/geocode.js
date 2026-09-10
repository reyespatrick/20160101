/** Reverse geocoding through the relay, so no map key ever reaches the phone. */
import { ApiError } from './inmovilla'
import { authHeader, reportUnauthorized } from './session'

export async function reverseGeocode({ lat, lon, lang }) {
  let res
  try {
    res = await fetch('/api/geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ lat, lon, lang }),
    })
  } catch {
    throw new ApiError('Sin conexión con el servidor', 0)
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = Object.assign(new ApiError(body.error || `Error ${res.status}`, res.status), { code: body.code })
    reportUnauthorized(err)
    throw err
  }
  return body.address
}
