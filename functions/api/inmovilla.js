/**
 * apiweb read proxy. Any signed-in user may read; the agency's keys are added here and
 * never leave the server. Rate limited upstream so Inmovilla never blocks our IP.
 */
import { authenticate, requireApiweb } from '../_shared/auth.js'
import { guard, json, readJson } from '../_shared/http.js'
import { apiweb } from '../_shared/inmovilla.js'

export const onRequestPost = guard(async (context) => {
  const session = await authenticate(context)
  if (session.response) return session.response
  const denied = requireApiweb(session)
  if (denied) return denied

  const { requests, idioma } = await readJson(context.request, 64 * 1024)
  if (!Array.isArray(requests) || requests.length === 0 || requests.length > 5) {
    return json({ error: 'Provide between 1 and 5 requests' }, 400)
  }

  const creds = await session.data.agencyCredentials(session.agency.id)
  const clientIp = context.request.headers.get('cf-connecting-ip') || ''
  return json(await apiweb(context.env, { ...creds, idioma: Number(idioma) || creds.idioma }, requests, { clientIp }))
})
