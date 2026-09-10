/** Geocoding through the relay, so no map key ever reaches the phone. */
import { ApiError } from './inmovilla'
import { authHeader, reportUnauthorized } from './session'

async function post(body) {
  let res
  try {
    res = await fetch('/api/geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(body),
    })
  } catch {
    throw new ApiError('Sin conexión con el servidor', 0)
  }
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = Object.assign(new ApiError(payload.error || `Error ${res.status}`, res.status), { code: payload.code })
    reportUnauthorized(err)
    throw err
  }
  return payload
}

/** Where the phone stands → a postal address, plus the plot reference under it. */
export async function reverseGeocode({ lat, lon, lang }) {
  const body = await post({ lat, lon, lang })
  return { address: body.address || {}, cadastre: body.cadastre || null, cadastreError: body.cadastreError || '' }
}

/**
 * A typed address → the plot reference. The Catastro answers on the address itself, so editing
 * the street by hand keeps the cadastral reference just as true as reading it from the GPS.
 */
export async function cadastreByAddress({ province, city, street, number }) {
  const body = await post({ address: { province, city, street, number } })
  return body.cadastre || null
}
