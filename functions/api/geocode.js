/**
 * Reverse geocoding for the "read the address" button: the phone sends where it is, this
 * returns a postal address. Any signed-in user may call it; no Inmovilla key is involved.
 */
import { authenticate } from '../_shared/auth.js'
import { fail, guard, json, readJson } from '../_shared/http.js'
import { reverseGeocode } from '../../shared/geocode.js'

export const onRequestPost = guard(async (context) => {
  const session = await authenticate(context)
  if (session.response) return session.response

  const { lat, lon, lang } = await readJson(context.request, 4096)
  const address = await reverseGeocode({ lat, lon, lang: ['es', 'fr', 'en'].includes(lang) ? lang : 'es', env: context.env })
  if (!address) return fail('No se encontró ninguna dirección en ese punto', 404, 'nomatch')
  return json({ address })
})
