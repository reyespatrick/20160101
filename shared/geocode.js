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
const CATASTRO_URL = 'https://ovc.catastro.meh.es/OVCServWeb/OVCWcfCallejero/COVCCoordenadas.svc/json/Consulta_RCCOOR'
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

/**
 * Spain's cadastre answers the one thing no map provider can: the **referencia catastral** of
 * the plot under those coordinates. Free, keyless and official (Sede Electrónica del Catastro),
 * it also returns the address as one line. It refuses a request whose User-Agent it does not
 * recognise, hence the explicit one — a plain `curl` default is turned away with an HTML page.
 */
export function fromCatastro(payload) {
  const result = payload?.Consulta_RCCOORResult
  if (!result || result.control?.cuerr) return null
  const coord = result.coordenadas?.coord?.[0] || result.coordenadas?.coord
  const pc = coord?.pc
  if (!pc?.pc1 || !pc?.pc2) return null
  return { reference: `${pc.pc1}${pc.pc2}`, label: (coord.ldt || '').trim() }
}

/**
 * Throws on a transport problem and returns null only when there genuinely is no plot at that
 * point. Callers decide what to do: the endpoint reports the reason rather than swallowing it,
 * because "no reference" and "the service refused us" need very different fixes.
 */
export async function cadastralReference({ lat, lon, env = {} }) {
  if (!validCoordinates(lat, lon)) return null
  const url = `${CATASTRO_URL}?CoorX=${encodeURIComponent(lon)}&CoorY=${encodeURIComponent(lat)}&SRS=EPSG:4326`
  const { status, text } = await withTimeout(async (signal) => {
    const res = await fetch(url, { signal, headers: { 'User-Agent': env.GEOCODE_USER_AGENT || USER_AGENT, Accept: 'application/json' } })
    return { status: res.status, text: await res.text() }
  })
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    // The Catastro answers an HTML page when it turns a caller away; pass its wording on.
    const plain = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)
    throw Object.assign(new Error(`Catastro ${status}: ${plain || 'respuesta ilegible'}`), { status: 502 })
  }
  return fromCatastro(payload)
}

const USER_AGENT = 'Mozilla/5.0 (compatible; immoba/1.0; real-estate field app)'

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
