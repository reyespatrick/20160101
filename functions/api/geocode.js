/**
 * Reverse geocoding for the "read the address" button: the phone sends where it is, this
 * returns a postal address. Any signed-in user may call it; no Inmovilla key is involved.
 */
import { authenticate } from '../_shared/auth.js'
import { fail, guard, json, readJson } from '../_shared/http.js'
import { cadastralByAddress, cadastralReference, reverseGeocode } from '../../shared/geocode.js'

export const onRequestPost = guard(async (context) => {
  const session = await authenticate(context)
  if (session.response) return session.response

  const { lat, lon, lang, address: typed } = await readJson(context.request, 4096)

  // Address sheet: the plot reference straight from a typed address, no map provider involved.
  if (typed) {
    const cadastre = await cadastralByAddress({
      province: typed.province,
      municipality: typed.city,
      street: typed.street,
      number: typed.number,
      env: context.env,
    })
    return json({ address: {}, cadastre })
  }
  // Both in one round trip: the map provider for the postal address, the Spanish cadastre for
  // the plot reference. Either may come back empty without failing the other.
  let cadastreError = null
  const [address, cadastre] = await Promise.all([
    reverseGeocode({ lat, lon, lang: ['es', 'fr', 'en'].includes(lang) ? lang : 'es', env: context.env }),
    cadastralReference({ lat, lon, env: context.env }).catch((err) => {
      cadastreError = err?.message || 'unknown'
      return null
    }),
  ])
  if (!address && !cadastre) return fail('No se encontró ninguna dirección en ese punto', 404, 'nomatch')
  return json({ address: address || {}, cadastre, cadastreError })
})
