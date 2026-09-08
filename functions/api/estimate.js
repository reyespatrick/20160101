/**
 * Property valuation with Claude. Reads comparables from Inmovilla and writes nothing there,
 * so the agency write lock deliberately does not apply: a locked agency can still value a
 * property. The role check stays — a read-only account has no reason to spend the agency's
 * Anthropic credit.
 */
import { authenticate, canWrite, requireApiweb } from '../_shared/auth.js'
import { fail, guard, json, readJson } from '../_shared/http.js'
import { apiweb } from '../_shared/inmovilla.js'
import { estimateProperty } from '../../server/estimate.js'

export const onRequestPost = guard(async (context) => {
  const session = await authenticate(context)
  if (session.response) return session.response
  const missing = requireApiweb(session) // comparables come from the listing
  if (missing) return missing
  if (!canWrite(session.user.role)) return fail('Tu cuenta es de solo lectura', 403, 'role')

  const creds = await session.data.agencyCredentials(session.agency.id)
  if (!creds.anthropicKey) return fail('La agencia aún no tiene configurada la clave de Anthropic', 409, 'anthropic')

  const { property, locale } = await readJson(context.request)
  if (!property || typeof property !== 'object') return fail('Falta la propiedad')

  const clientIp = context.request.headers.get('cf-connecting-ip') || ''
  const query = (c, requests) => apiweb(context.env, c, requests, { clientIp })
  return json(
    await estimateProperty({
      apiwebQuery: query,
      creds,
      input: property,
      locale: ['es', 'fr', 'en'].includes(locale) ? locale : 'es',
      mock: context.env.INMOVILLA_MOCK === '1',
    }),
  )
})
