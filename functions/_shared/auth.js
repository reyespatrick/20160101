/**
 * Session and permissions for the Pages Functions.
 *
 * Users authenticate against Supabase Auth from the browser; the access token they send is
 * verified here on every call, and the profile is reloaded each time so a deactivation, a
 * role change or the agency's write lock takes effect immediately rather than at next login.
 *
 * The three answers the app already knows how to react to are preserved:
 *   401 code=session   the token is missing, expired or the account is deactivated
 *   403 code=role      the role does not allow this
 *   403 code=locked    the agency is in read-only mode
 *   409 code=keys      the agency has no Inmovilla keys yet
 */
import { createData } from './data.js'
import { fail } from './http.js'

export const canWrite = (role) => role === 'admin' || role === 'agent'
export const canDelete = (role) => role === 'admin'

export function bearer(request) {
  const header = request.headers.get('authorization') || ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

/**
 * Resolves the caller. Returns `{ user, agency, data }`, or `{ response }` to return as is.
 */
export async function authenticate(context) {
  const data = createData(context.env)
  const token = bearer(context.request)
  if (!token) return { response: fail('Sesión no válida', 401, 'session') }

  const authUser = await data.client.userFromToken(token)
  if (!authUser) return { response: fail('Sesión caducada, vuelve a entrar', 401, 'session') }

  const user = await data.getProfile(authUser.id)
  if (!user) return { response: fail('Esta cuenta ya no existe', 401, 'session') }
  if (!user.active) return { response: fail('Cuenta desactivada. Contacta con el administrador de tu agencia.', 401, 'session') }

  const agency = await data.getAgency(user.agencyId)
  if (!agency) return { response: fail('La agencia ya no existe', 401, 'session') }

  return { user, agency, data, token }
}

/** Admin-only routes. */
export const requireAdmin = (session) => (session.user.role === 'admin' ? null : fail('Solo un administrador puede hacer esto', 403, 'role'))

/** The agency's Inmovilla keys must be configured. */
export const requireKeys = (session) =>
  session.agency.hasKeys ? null : fail('La agencia aún no tiene configuradas las claves de Inmovilla', 409, 'keys')

/**
 * Anything that would create, modify or delete in Inmovilla. The agency-wide lock is checked
 * before the role, and an agency whose state is unknown counts as locked.
 */
export function requireWrite(session, { destructive = false } = {}) {
  if (session.agency.readOnly !== false) {
    return fail('La agencia está en modo solo lectura. Un administrador debe desactivarlo en el perfil.', 403, 'locked')
  }
  if (!canWrite(session.user.role)) return fail('Tu cuenta es de solo lectura', 403, 'role')
  if (destructive && !canDelete(session.user.role)) return fail('Solo un administrador puede eliminar en Inmovilla', 403, 'role')
  return null
}
