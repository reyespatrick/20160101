/**
 * Accounts database (SQLite via node:sqlite, no native dependency).
 *
 * agencies: one Inmovilla agency = one tenant; its Inmovilla keys are stored encrypted.
 * users:    people who log into the app, each belonging to one agency, with a role.
 *
 * This is the only persistent state besides the temporary photo files.
 */
import { DatabaseSync } from 'node:sqlite'
import crypto from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const ROLES = ['admin', 'agent', 'readonly']

let db
let secretKey

export function openDb(dataDir) {
  mkdirSync(dataDir, { recursive: true })
  db = new DatabaseSync(path.join(dataDir, 'immoba.sqlite'))
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS agencies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      numagencia TEXT NOT NULL DEFAULT '',
      apiweb_password TEXT NOT NULL DEFAULT '',
      rest_token TEXT NOT NULL DEFAULT '',
      idioma INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agency_id INTEGER NOT NULL REFERENCES agencies(id),
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'agent',
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      last_login_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS users_agency ON users(agency_id);
  `)
  secretKey = loadSecret(dataDir)
  return db
}

/** Encryption key: APP_SECRET, or a generated secret persisted in DATA_DIR so restarts keep decrypting. */
function loadSecret(dataDir) {
  let secret = process.env.APP_SECRET
  if (!secret) {
    const file = path.join(dataDir, 'secret.key')
    if (existsSync(file)) secret = readFileSync(file, 'utf8').trim()
    else {
      secret = crypto.randomBytes(32).toString('hex')
      writeFileSync(file, secret, { mode: 0o600 })
      console.warn(`[db] APP_SECRET not set: generated one in ${file}. Keep that file or set APP_SECRET.`)
    }
  }
  return crypto.createHash('sha256').update(secret).digest()
}
export function getSecret() {
  return secretKey
}

// ---- crypto helpers ----
export function encrypt(text) {
  if (!text) return ''
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey, iv)
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()])
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${enc.toString('base64url')}`
}
export function decrypt(blob) {
  if (!blob) return ''
  const [iv, tag, data] = blob.split('.')
  const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey, Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(String(password), salt, 64)
  return `scrypt.${salt.toString('base64url')}.${hash.toString('base64url')}`
}
export function verifyPassword(password, stored) {
  try {
    const [, salt, hash] = String(stored).split('.')
    const expected = Buffer.from(hash, 'base64url')
    const actual = crypto.scryptSync(String(password), Buffer.from(salt, 'base64url'), expected.length)
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

// ---- agencies ----
export function createAgency({ name }) {
  const r = db.prepare('INSERT INTO agencies (name, created_at) VALUES (?, ?)').run(String(name).trim(), Date.now())
  return getAgency(Number(r.lastInsertRowid))
}
export function getAgency(id) {
  const row = db.prepare('SELECT * FROM agencies WHERE id = ?').get(id)
  return row ? { ...row, hasKeys: Boolean(row.numagencia && row.apiweb_password && row.rest_token) } : null
}
/** Decrypted Inmovilla credentials of an agency (server side only). */
export function agencyCredentials(id) {
  const a = getAgency(id)
  if (!a) return null
  return { numagencia: a.numagencia, password: decrypt(a.apiweb_password), restToken: decrypt(a.rest_token), idioma: a.idioma || 1 }
}
export function setAgencyKeys(id, { numagencia, apiwebPassword, restToken, idioma }) {
  const a = getAgency(id)
  if (!a) return null
  db.prepare('UPDATE agencies SET numagencia = ?, apiweb_password = ?, rest_token = ?, idioma = ? WHERE id = ?').run(
    numagencia !== undefined ? String(numagencia).trim() : a.numagencia,
    apiwebPassword ? encrypt(apiwebPassword) : a.apiweb_password,
    restToken ? encrypt(restToken) : a.rest_token,
    Number(idioma) || a.idioma || 1,
    id,
  )
  return getAgency(id)
}
export function updateAgency(id, { name, idioma }) {
  db.prepare('UPDATE agencies SET name = COALESCE(?, name), idioma = COALESCE(?, idioma) WHERE id = ?').run(name ?? null, idioma ?? null, id)
  return getAgency(id)
}
export function countUsers() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n
}

// ---- users ----
export const publicUser = (u) => (u ? { id: u.id, agencyId: u.agency_id, email: u.email, name: u.name, role: u.role, active: Boolean(u.active), createdAt: u.created_at, lastLoginAt: u.last_login_at } : null)

export function createUser({ agencyId, email, name, password, role = 'agent' }) {
  if (!ROLES.includes(role)) throw new Error('Rol no válido')
  const r = db.prepare('INSERT INTO users (agency_id, email, name, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)').run(
    agencyId, String(email).trim().toLowerCase(), String(name || '').trim(), hashPassword(password), role, Date.now(),
  )
  return getUser(Number(r.lastInsertRowid))
}
export function getUser(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null
}
export function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim().toLowerCase()) || null
}
export function listUsers(agencyId) {
  return db.prepare('SELECT * FROM users WHERE agency_id = ? ORDER BY created_at').all(agencyId).map(publicUser)
}
export function updateUser(id, { name, role, active, password }) {
  const u = getUser(id)
  if (!u) return null
  if (role !== undefined && !ROLES.includes(role)) throw new Error('Rol no válido')
  db.prepare('UPDATE users SET name = ?, role = ?, active = ?, password_hash = ? WHERE id = ?').run(
    name !== undefined ? String(name).trim() : u.name,
    role !== undefined ? role : u.role,
    active !== undefined ? (active ? 1 : 0) : u.active,
    password ? hashPassword(password) : u.password_hash,
    id,
  )
  return getUser(id)
}
export function deleteUser(id) {
  db.prepare('DELETE FROM users WHERE id = ?').run(id)
}
export function touchLogin(id) {
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), id)
}
export function countAdmins(agencyId) {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE agency_id = ? AND role = 'admin' AND active = 1").get(agencyId).n
}
