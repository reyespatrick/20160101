/**
 * Accounts API: agency setup, login, profile, Inmovilla keys (admin) and user management (admin).
 */
import express from 'express'
import { requireRole, requireUser, signSession } from './auth.js'
import * as db from './db.js'

const SIGNUP_CODE = process.env.SIGNUP_CODE || ''
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function createAccountsRouter({ verifyInmovillaKeys }) {
  const router = express.Router()
  router.use(express.json({ limit: '64kb' }))

  const bad = (res, msg, status = 400) => res.status(status).json({ error: msg })
  const validAccount = (b) => {
    if (!EMAIL_RE.test(String(b.email || ''))) return 'Email no válido'
    if (String(b.password || '').length < 8) return 'La contraseña debe tener al menos 8 caracteres'
    return null
  }
  const sessionPayload = (user) => {
    const agency = db.getAgency(user.agency_id)
    return { ...signSession(user), user: db.publicUser(user), agency: { id: agency.id, name: agency.name, numagencia: agency.numagencia, idioma: agency.idioma, hasKeys: agency.hasKeys } }
  }

  /** Whether the server still has no users (first start). */
  router.get('/status', (_req, res) => {
    res.json({ needsSetup: db.countUsers() === 0, signupOpen: !SIGNUP_CODE || db.countUsers() === 0 })
  })

  /** Create an agency and its first admin. Open on first start; afterwards gated by SIGNUP_CODE when set. */
  router.post('/signup', (req, res) => {
    const b = req.body || {}
    const first = db.countUsers() === 0
    if (!first && SIGNUP_CODE && b.signupCode !== SIGNUP_CODE) return bad(res, 'Código de alta incorrecto', 403)
    if (!String(b.agencyName || '').trim()) return bad(res, 'Indica el nombre de la agencia')
    const err = validAccount(b)
    if (err) return bad(res, err)
    if (db.getUserByEmail(b.email)) return bad(res, 'Ya existe una cuenta con ese email', 409)
    const agency = db.createAgency({ name: b.agencyName })
    const user = db.createUser({ agencyId: agency.id, email: b.email, name: b.name, password: b.password, role: 'admin' })
    db.touchLogin(user.id)
    res.status(201).json(sessionPayload(user))
  })

  router.post('/login', (req, res) => {
    const { email, password } = req.body || {}
    const user = email && db.getUserByEmail(email)
    if (!user || !db.verifyPassword(password || '', user.password_hash)) return bad(res, 'Email o contraseña incorrectos', 401)
    if (!user.active) return bad(res, 'Cuenta desactivada. Contacta con el administrador de tu agencia.', 403)
    db.touchLogin(user.id)
    res.json(sessionPayload(user))
  })

  router.get('/me', requireUser, (req, res) => res.json(sessionPayload(req.user)))

  /** Own profile: name and password. */
  router.put('/me', requireUser, (req, res) => {
    const b = req.body || {}
    if (b.newPassword) {
      if (!db.verifyPassword(b.currentPassword || '', req.user.password_hash)) return bad(res, 'La contraseña actual no es correcta', 403)
      if (String(b.newPassword).length < 8) return bad(res, 'La nueva contraseña debe tener al menos 8 caracteres')
    }
    const user = db.updateUser(req.user.id, { name: b.name, password: b.newPassword })
    res.json({ user: db.publicUser(user) })
  })

  /** Agency settings (admin): name, Inmovilla keys. Keys are verified against Inmovilla before being saved. */
  router.get('/agency', requireUser, (req, res) => {
    const a = db.getAgency(req.user.agency_id)
    res.json({ agency: { id: a.id, name: a.name, numagencia: a.numagencia, idioma: a.idioma, hasKeys: a.hasKeys, hasApiweb: Boolean(a.apiweb_password), hasRest: Boolean(a.rest_token) } })
  })
  router.put('/agency', requireUser, requireRole('admin'), async (req, res) => {
    const b = req.body || {}
    const current = db.agencyCredentials(req.user.agency_id)
    const candidate = {
      numagencia: b.numagencia !== undefined ? String(b.numagencia).trim() : current.numagencia,
      password: b.apiwebPassword ? String(b.apiwebPassword).trim() : current.password,
      restToken: b.restToken ? String(b.restToken).trim() : current.restToken,
      idioma: Number(b.idioma) || current.idioma || 1,
    }
    if (b.numagencia !== undefined || b.apiwebPassword || b.restToken) {
      if (!candidate.numagencia || !candidate.password || !candidate.restToken) return bad(res, 'Faltan el número de agencia, la clave web o la clave REST')
      try {
        await verifyInmovillaKeys(candidate)
      } catch (err) {
        return bad(res, err.message || 'Inmovilla rechazó las claves', err.status === 401 || err.status === 403 ? 401 : 502)
      }
    }
    db.setAgencyKeys(req.user.agency_id, { numagencia: candidate.numagencia, apiwebPassword: b.apiwebPassword, restToken: b.restToken, idioma: candidate.idioma })
    if (b.name) db.updateAgency(req.user.agency_id, { name: String(b.name).trim() })
    const a = db.getAgency(req.user.agency_id)
    res.json({ agency: { id: a.id, name: a.name, numagencia: a.numagencia, idioma: a.idioma, hasKeys: a.hasKeys, hasApiweb: Boolean(a.apiweb_password), hasRest: Boolean(a.rest_token) } })
  })

  /** Users of the agency (admin). */
  router.get('/users', requireUser, requireRole('admin'), (req, res) => res.json({ users: db.listUsers(req.user.agency_id) }))
  router.post('/users', requireUser, requireRole('admin'), (req, res) => {
    const b = req.body || {}
    const err = validAccount(b)
    if (err) return bad(res, err)
    if (!db.ROLES.includes(b.role || 'agent')) return bad(res, 'Rol no válido')
    if (db.getUserByEmail(b.email)) return bad(res, 'Ya existe una cuenta con ese email', 409)
    const user = db.createUser({ agencyId: req.user.agency_id, email: b.email, name: b.name, password: b.password, role: b.role || 'agent' })
    res.status(201).json({ user: db.publicUser(user) })
  })
  router.put('/users/:id', requireUser, requireRole('admin'), (req, res) => {
    const target = db.getUser(Number(req.params.id))
    if (!target || target.agency_id !== req.user.agency_id) return bad(res, 'Usuario no encontrado', 404)
    const b = req.body || {}
    if (b.role !== undefined && !db.ROLES.includes(b.role)) return bad(res, 'Rol no válido')
    if (b.password && String(b.password).length < 8) return bad(res, 'La contraseña debe tener al menos 8 caracteres')
    const demoting = target.role === 'admin' && ((b.role !== undefined && b.role !== 'admin') || b.active === false)
    if (demoting && db.countAdmins(req.user.agency_id) <= 1) return bad(res, 'La agencia necesita al menos un administrador activo')
    res.json({ user: db.publicUser(db.updateUser(target.id, b)) })
  })
  router.delete('/users/:id', requireUser, requireRole('admin'), (req, res) => {
    const target = db.getUser(Number(req.params.id))
    if (!target || target.agency_id !== req.user.agency_id) return bad(res, 'Usuario no encontrado', 404)
    if (target.id === req.user.id) return bad(res, 'No puedes eliminar tu propia cuenta')
    if (target.role === 'admin' && db.countAdmins(req.user.agency_id) <= 1) return bad(res, 'La agencia necesita al menos un administrador activo')
    db.deleteUser(target.id)
    res.json({ ok: true })
  })

  return router
}
