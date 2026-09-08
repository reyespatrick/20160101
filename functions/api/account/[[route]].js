/**
 * Accounts: agency setup, sign-in, own profile, Inmovilla keys (admin), users (admin).
 *
 * People are stored in Supabase Auth; `profiles` adds the agency, the role and the active
 * flag. Signing in goes through Supabase so passwords and resets are never handled here.
 */
import { authenticate, requireAdmin } from '../../_shared/auth.js'
import { createData, ROLES } from '../../_shared/data.js'
import { fail, guard, json, readJson } from '../../_shared/http.js'
import { verifyKeys } from '../../_shared/inmovilla.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const path = (context) => '/' + (context.params.route || []).join('/')

const sessionPayload = (session, user, agency) => ({ ...session, user, agency })

const validAccount = (b) => {
  if (!EMAIL_RE.test(String(b.email || ''))) return 'Email no válido'
  if (String(b.password || '').length < 8) return 'La contraseña debe tener al menos 8 caracteres'
  return null
}

export const onRequest = guard(async (context) => {
  const { request, env } = context
  const route = path(context)
  const method = request.method.toUpperCase()
  const data = createData(env)

  // ---- public ----
  if (route === '/status' && method === 'GET') {
    const users = await data.countUsers()
    return json({ needsSetup: users === 0, signupOpen: !env.SIGNUP_CODE || users === 0 })
  }

  if (route === '/signup' && method === 'POST') {
    const b = await readJson(request)
    const first = (await data.countUsers()) === 0
    if (!first && env.SIGNUP_CODE && b.signupCode !== env.SIGNUP_CODE) return fail('Código de alta incorrecto', 403)
    if (!String(b.agencyName || '').trim()) return fail('Indica el nombre de la agencia')
    const invalid = validAccount(b)
    if (invalid) return fail(invalid)

    const authUser = await data.client.auth.createUser({ email: b.email, password: b.password, metadata: { name: b.name || '' } }).catch((err) => {
      throw Object.assign(new Error(/already|registered|exists/i.test(err.message) ? 'Ya existe una cuenta con ese email' : err.message), {
        status: /already|registered|exists/i.test(err.message) ? 409 : err.status || 400,
      })
    })

    // The agency must exist before the profile that references it; roll the account back if it fails.
    let agency
    try {
      agency = await data.createAgency({ name: b.agencyName })
      await data.createProfile({ id: authUser.id, agencyId: agency.id, email: b.email, name: b.name, role: 'admin' })
    } catch (err) {
      await data.client.auth.deleteUser(authUser.id).catch(() => {})
      if (agency) await data.client.remove('agencies', { id: agency.id }).catch(() => {})
      throw err
    }

    const auth = await data.client.auth.signInWithPassword({ email: b.email, password: b.password })
    await data.touchLogin(authUser.id)
    return json(sessionPayload(auth, await data.getProfile(authUser.id), agency), 201)
  }

  if (route === '/login' && method === 'POST') {
    const b = await readJson(request)
    const auth = await data.client.auth.signInWithPassword({ email: b.email, password: b.password })
    const user = await data.getProfile(auth.user?.id)
    if (!user) return fail('Esta cuenta no pertenece a ninguna agencia', 403)
    if (!user.active) return fail('Cuenta desactivada. Contacta con el administrador de tu agencia.', 403)
    await data.touchLogin(user.id)
    return json(sessionPayload(auth, user, await data.getAgency(user.agencyId)))
  }

  // ---- everything below needs a session ----
  const session = await authenticate(context)
  if (session.response) return session.response
  const { user, agency } = session

  if (route === '/me' && method === 'GET') return json({ user, agency })

  if (route === '/me' && method === 'PUT') {
    const b = await readJson(request)
    if (b.newPassword) {
      if (String(b.newPassword).length < 8) return fail('La nueva contraseña debe tener al menos 8 caracteres')
      // Supabase has no "verify current password" call: re-authenticating is the check.
      await data.client.auth.signInWithPassword({ email: user.email, password: b.currentPassword || '' }).catch(() => {
        throw Object.assign(new Error('La contraseña actual no es correcta'), { status: 403 })
      })
      await data.client.auth.updateUser(user.id, { password: b.newPassword })
    }
    return json({ user: b.name !== undefined ? await data.updateProfile(user.id, { name: b.name }) : user })
  }

  if (route === '/agency' && method === 'GET') return json({ agency })

  if (route === '/agency' && method === 'PUT') {
    const denied = requireAdmin(session)
    if (denied) return denied
    const b = await readJson(request)
    const current = await data.agencyCredentials(agency.id)
    const candidate = {
      numagencia: b.numagencia !== undefined ? String(b.numagencia).trim() : current.numagencia,
      password: b.apiwebPassword ? String(b.apiwebPassword).trim() : current.password,
      restToken: b.restToken ? String(b.restToken).trim() : current.restToken,
      idioma: Number(b.idioma) || current.idioma || 1,
    }
    if (b.numagencia !== undefined || b.apiwebPassword || b.restToken) {
      if (!candidate.numagencia || !candidate.password || !candidate.restToken) return fail('Faltan el número de agencia, la clave web o la clave REST')
      await verifyKeys(env, candidate).catch((err) => {
        throw Object.assign(new Error(err.message || 'Inmovilla rechazó las claves'), { status: err.status === 401 || err.status === 403 ? 401 : 502 })
      })
    }
    if (b.readOnly !== undefined) await data.setAgencyReadOnly(agency.id, b.readOnly)
    await data.setAgencyKeys(agency.id, {
      numagencia: candidate.numagencia,
      apiwebPassword: b.apiwebPassword,
      restToken: b.restToken,
      anthropicKey: b.anthropicKey === null ? null : b.anthropicKey || undefined,
      idioma: candidate.idioma,
    })
    if (b.name) await data.updateAgency(agency.id, { name: b.name })
    return json({ agency: await data.getAgency(agency.id) })
  }

  // ---- users (admin) ----
  if (route.startsWith('/users')) {
    const denied = requireAdmin(session)
    if (denied) return denied
    const targetId = route.slice('/users/'.length)

    if (route === '/users' && method === 'GET') return json({ users: await data.listProfiles(agency.id) })

    if (route === '/users' && method === 'POST') {
      const b = await readJson(request)
      const invalid = validAccount(b)
      if (invalid) return fail(invalid)
      if (!ROLES.includes(b.role || 'agent')) return fail('Rol no válido')
      const authUser = await data.client.auth.createUser({ email: b.email, password: b.password, metadata: { name: b.name || '' } }).catch((err) => {
        throw Object.assign(new Error(/already|registered|exists/i.test(err.message) ? 'Ya existe una cuenta con ese email' : err.message), { status: 409 })
      })
      try {
        return json({ user: await data.createProfile({ id: authUser.id, agencyId: agency.id, email: b.email, name: b.name, role: b.role || 'agent' }) }, 201)
      } catch (err) {
        await data.client.auth.deleteUser(authUser.id).catch(() => {})
        throw err
      }
    }

    const target = targetId ? await data.getProfile(targetId) : null
    if (!target || target.agencyId !== agency.id) return fail('Usuario no encontrado', 404)

    if (method === 'PUT') {
      const b = await readJson(request)
      if (b.role !== undefined && !ROLES.includes(b.role)) return fail('Rol no válido')
      if (b.password && String(b.password).length < 8) return fail('La contraseña debe tener al menos 8 caracteres')
      const demoting = target.role === 'admin' && ((b.role !== undefined && b.role !== 'admin') || b.active === false)
      if (demoting && (await data.countAdmins(agency.id)) <= 1) return fail('La agencia necesita al menos un administrador activo')
      if (b.password) await data.client.auth.updateUser(target.id, { password: b.password })
      return json({ user: await data.updateProfile(target.id, b) })
    }

    if (method === 'DELETE') {
      if (target.id === user.id) return fail('No puedes eliminar tu propia cuenta')
      if (target.role === 'admin' && (await data.countAdmins(agency.id)) <= 1) return fail('La agencia necesita al menos un administrador activo')
      await data.deleteProfile(target.id)
      await data.client.auth.deleteUser(target.id)
      return json({ ok: true })
    }
  }

  return fail('No encontrado', 404)
})
