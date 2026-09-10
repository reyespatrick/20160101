/**
 * Reverse geocoding: coordinates → a postal address the listing form can fill in.
 *
 * Runs on both runtimes (plain fetch, no Node built-ins). Two providers:
 *
 *   Google  when GOOGLE_MAPS_API_KEY is set — the better data for Spain, billed per call.
 *   Nominatim (OpenStreetMap) otherwise — free and keyless, but its usage policy caps callers
 *           at one request per second and asks for an identifying User-Agent, both honoured here.
 *
 * The key never reaches the phone: the browser sends coordinates to our own endpoint, which
 * calls the provider. That also lets us swap providers without shipping a new app.
 */
const GOOGLE_URL = 'https://maps.googleapis.com/maps/api/geocode/json'
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse'
const TIMEOUT_MS = 12_000

export function validCoordinates(lat, lon) {
  // Reject the absent value explicitly: Number(null) and Number('') are 0, which would
  // silently geocode the Atlantic instead of reporting that we have no position.
  const given = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))
  return given(lat) && given(lon) && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lon)) <= 180
}

/** Google returns address_components; pick the ones the form has fields for. */
export function fromGoogle(payload) {
  const result = payload?.results?.[0]
  if (!result) return null
  const part = (type) => result.address_components?.find((c) => c.types?.includes(type))?.long_name || ''
  return {
    number: part('street_number'),
    street: part('route'),
    postalCode: part('postal_code'),
    city: part('locality') || part('postal_town') || part('administrative_area_level_3'),
    province: part('administrative_area_level_2'),
    label: result.formatted_address || '',
    provider: 'google',
  }
}

/** Nominatim returns a flat `address` object with varying keys per country. */
export function fromNominatim(payload) {
  const a = payload?.address
  if (!a) return null
  return {
    number: a.house_number || '',
    street: a.road || a.pedestrian || a.footway || '',
    postalCode: a.postcode || '',
    city: a.city || a.town || a.village || a.municipality || a.hamlet || '',
    province: a.province || a.state_district || a.state || '',
    label: payload.display_name || '',
    provider: 'nominatim',
  }
}

async function withTimeout(fn) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fn(controller.signal)
  } catch (err) {
    if (err.name === 'AbortError') throw Object.assign(new Error('El servicio de mapas no responde'), { status: 504 })
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** Nominatim asks for at most one request per second from a given caller. */
let lastNominatimAt = 0
async function respectNominatimRate() {
  const wait = Math.max(0, lastNominatimAt + 1100 - Date.now())
  if (wait) await new Promise((r) => setTimeout(r, wait))
  lastNominatimAt = Date.now()
}

export async function reverseGeocode({ lat, lon, lang = 'es', env = {} }) {
  if (!validCoordinates(lat, lon)) throw Object.assign(new Error('Coordenadas no válidas'), { status: 400 })

  if (env.GOOGLE_MAPS_API_KEY) {
    const url = `${GOOGLE_URL}?latlng=${encodeURIComponent(`${lat},${lon}`)}&language=${encodeURIComponent(lang)}&key=${encodeURIComponent(env.GOOGLE_MAPS_API_KEY)}`
    const payload = await withTimeout(async (signal) => (await fetch(url, { signal })).json())
    if (payload.status === 'REQUEST_DENIED') throw Object.assign(new Error('Google rechazó la clave de mapas'), { status: 401 })
    if (payload.status === 'ZERO_RESULTS') return null
    if (payload.status !== 'OK') throw Object.assign(new Error(`Google respondió ${payload.status}`), { status: 502 })
    return fromGoogle(payload)
  }

  await respectNominatimRate()
  const url = `${NOMINATIM_URL}?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=18&addressdetails=1&accept-language=${encodeURIComponent(lang)}`
  const payload = await withTimeout(async (signal) =>
    (await fetch(url, { signal, headers: { 'User-Agent': env.GEOCODE_USER_AGENT || 'immoba/1.0 (real-estate field app)', Accept: 'application/json' } })).json(),
  )
  if (payload?.error) return null
  return fromNominatim(payload)
}
