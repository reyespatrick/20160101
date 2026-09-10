/**
 * Inmovilla REST v1 relay. The request is passed through untouched apart from the agency's
 * token; what is enforced here is the agency write lock first, then the caller's role.
 * Reads stay open to everyone, so a locked agency remains fully browsable.
 */
import { authenticate, requireRest, requireWrite } from '../../_shared/auth.js'
import { guard } from '../../_shared/http.js'
import { rest } from '../../_shared/inmovilla.js'

export const onRequest = guard(async (context) => {
  const session = await authenticate(context)
  if (session.response) return session.response
  const missing = requireRest(session)
  if (missing) return missing

  const method = context.request.method.toUpperCase()
  if (method !== 'GET') {
    const denied = requireWrite(session, { destructive: method === 'DELETE' })
    if (denied) return denied
  }

  const url = new URL(context.request.url)
  // Read the path off the URL, not context.params: the router drops the trailing slash that
  // every Inmovilla route carries ("/clientes/", "/propiedades/"), and Inmovilla rejects the
  // stripped form. Express tolerated it locally, which is why this stayed hidden.
  const base = '/api/rest'
  const path = (url.pathname.startsWith(base) ? url.pathname.slice(base.length) || '/' : '/') + url.search
  const creds = await session.data.agencyCredentials(session.agency.id)
  const body = method === 'GET' || method === 'HEAD' ? null : await context.request.arrayBuffer()

  const upstream = await rest(context.env, creds.restToken, method, path, context.request.headers.get('content-type'), body)
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': upstream.type, 'Cache-Control': 'no-store' },
  })
})
