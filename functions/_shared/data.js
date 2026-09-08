/**
 * Agencies and profiles on Supabase, mirroring the API of `server/db.js` so the routes read
 * the same on both runtimes — except that everything here is async.
 *
 * Inmovilla and Anthropic keys are encrypted with APP_SECRET before they are written and
 * decrypted only here, so Supabase only ever stores ciphertext it cannot read.
 */
import { decrypt, encrypt, importKey } from '../../shared/crypto.js'
import { createSupabase } from './supabase.js'

export const ROLES = ['admin', 'agent', 'readonly']

const agencyView = (row) =>
  row
    ? {
        id: row.id,
        name: row.name,
        numagencia: row.numagencia,
        idioma: row.idioma,
        readOnly: row.read_only !== false,
        hasKeys: Boolean(row.numagencia && row.apiweb_password && row.rest_token),
        hasApiweb: Boolean(row.apiweb_password),
        hasRest: Boolean(row.rest_token),
        hasAnthropic: Boolean(row.anthropic_key),
      }
    : null

export const publicUser = (row) =>
  row
    ? {
        id: row.id,
        agencyId: row.agency_id,
        email: row.email,
        name: row.name,
        role: row.role,
        active: row.active !== false,
        createdAt: row.created_at,
        lastLoginAt: row.last_login_at,
      }
    : null

export function createData(env, client = createSupabase(env)) {
  let keyPromise
  const cryptoKey = () => (keyPromise ||= importKey(env.APP_SECRET))

  const enc = async (value) => (value ? encrypt(String(value), await cryptoKey()) : '')
  const dec = async (value) => (value ? decrypt(value, await cryptoKey()) : '')

  return {
    client,

    // ---- agencies ----
    async createAgency({ name }) {
      return agencyView(await client.insert('agencies', { name: String(name).trim() }))
    },
    async getAgency(id) {
      return agencyView(await client.select('agencies', { eq: { id }, single: true }))
    },
    /** Another tenant already using this Inmovilla account, if any. */
    async agencyByNumagencia(numagencia) {
      const rows = await client.select('agencies', { eq: { numagencia: String(numagencia).trim() } })
      return rows.map(agencyView)
    },
    /** Decrypted Inmovilla + Anthropic credentials. Server side only. */
    async agencyCredentials(id) {
      const row = await client.select('agencies', { eq: { id }, single: true })
      if (!row) return null
      return {
        numagencia: row.numagencia,
        password: await dec(row.apiweb_password),
        restToken: await dec(row.rest_token),
        anthropicKey: await dec(row.anthropic_key),
        idioma: row.idioma || 1,
        readOnly: row.read_only !== false,
      }
    },
    /** Blank values keep the stored key; `null` removes it. */
    async setAgencyKeys(id, { numagencia, apiwebPassword, restToken, anthropicKey, idioma }) {
      const patch = {}
      if (numagencia !== undefined) patch.numagencia = String(numagencia).trim()
      if (apiwebPassword) patch.apiweb_password = await enc(apiwebPassword)
      if (restToken) patch.rest_token = await enc(restToken)
      if (anthropicKey === null) patch.anthropic_key = ''
      else if (anthropicKey) patch.anthropic_key = await enc(anthropicKey)
      if (idioma) patch.idioma = Number(idioma)
      if (!Object.keys(patch).length) return this.getAgency(id)
      return agencyView(await client.update('agencies', { id }, patch))
    },
    /** The agency-wide write lock; on by default. */
    async setAgencyReadOnly(id, readOnly) {
      return agencyView(await client.update('agencies', { id }, { read_only: Boolean(readOnly) }))
    },
    async updateAgency(id, { name, idioma }) {
      const patch = {}
      if (name !== undefined) patch.name = String(name).trim()
      if (idioma) patch.idioma = Number(idioma)
      if (!Object.keys(patch).length) return this.getAgency(id)
      return agencyView(await client.update('agencies', { id }, patch))
    },

    // ---- profiles (one per auth.users row) ----
    async createProfile({ id, agencyId, email, name, role = 'agent' }) {
      if (!ROLES.includes(role)) throw Object.assign(new Error('Rol no válido'), { status: 400 })
      return publicUser(
        await client.insert('profiles', {
          id,
          agency_id: agencyId,
          email: String(email).trim().toLowerCase(),
          name: String(name || '').trim(),
          role,
        }),
      )
    },
    async getProfile(id) {
      return publicUser(await client.select('profiles', { eq: { id }, single: true }))
    },
    async getProfileByEmail(email) {
      return publicUser(await client.select('profiles', { eq: { email: String(email).trim().toLowerCase() }, single: true }))
    },
    async listProfiles(agencyId) {
      const rows = await client.select('profiles', { eq: { agency_id: agencyId }, order: 'created_at.asc' })
      return rows.map(publicUser)
    },
    async updateProfile(id, { name, role, active }) {
      if (role !== undefined && !ROLES.includes(role)) throw Object.assign(new Error('Rol no válido'), { status: 400 })
      const patch = {}
      if (name !== undefined) patch.name = String(name).trim()
      if (role !== undefined) patch.role = role
      if (active !== undefined) patch.active = Boolean(active)
      if (!Object.keys(patch).length) return this.getProfile(id)
      return publicUser(await client.update('profiles', { id }, patch))
    },
    async deleteProfile(id) {
      await client.remove('profiles', { id })
    },
    async touchLogin(id) {
      await client.update('profiles', { id }, { last_login_at: new Date().toISOString() })
    },
    async countUsers() {
      return client.count('profiles')
    },
    /** An agency must always keep one active administrator. */
    async countAdmins(agencyId) {
      const rows = await client.select('profiles', { eq: { agency_id: agencyId, role: 'admin', active: true }, columns: 'id' })
      return rows.length
    },
  }
}
