/**
 * Per-agency client (contact) store persisted to a JSON file.
 *
 * Records are merged with last-write-wins on `updatedAt`. Deletions are kept as
 * tombstones ({ deleted: true }) so offline devices learn about them on sync.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const CLIENT_FIELDS = [
  'id', 'name', 'surname', 'phone', 'email', 'type', 'status', 'operation', 'propertyTypes',
  'zones', 'budgetMin', 'budgetMax', 'bedrooms', 'notes', 'properties', 'createdAt', 'updatedAt', 'deleted',
]

const MAX_STRING = 4000
const MAX_LIST = 50

function str(v, max = 300) {
  return typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max)
}
function num(v) {
  const n = Number(v)
  return Number.isFinite(n) && v !== '' && v !== null ? n : null
}
function list(v) {
  return Array.isArray(v) ? v.slice(0, MAX_LIST).map((x) => str(x, 120)).filter(Boolean) : []
}

/** Normalise an incoming client record; returns null if unusable. */
export function sanitizeClient(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return null
  const id = str(raw.id, 64)
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return null
  const updatedAt = num(raw.updatedAt) ?? now
  return {
    id,
    name: str(raw.name),
    surname: str(raw.surname),
    phone: str(raw.phone, 60),
    email: str(raw.email, 200),
    type: str(raw.type, 30),
    status: str(raw.status, 30),
    operation: str(raw.operation, 20),
    propertyTypes: list(raw.propertyTypes),
    zones: list(raw.zones),
    budgetMin: num(raw.budgetMin),
    budgetMax: num(raw.budgetMax),
    bedrooms: num(raw.bedrooms),
    notes: str(raw.notes, MAX_STRING),
    properties: list(raw.properties),
    createdAt: num(raw.createdAt) ?? updatedAt,
    updatedAt: Math.min(updatedAt, now + 5 * 60_000), // ignore clocks far in the future
    deleted: Boolean(raw.deleted),
  }
}

/** Pure merge used by the store and mirrored by the client. Returns the winner. */
export function mergeClient(existing, incoming) {
  if (!existing) return incoming
  if (!incoming) return existing
  if (incoming.updatedAt > existing.updatedAt) return incoming
  if (incoming.updatedAt < existing.updatedAt) return existing
  // Same timestamp: a deletion wins, otherwise keep the existing record
  return incoming.deleted && !existing.deleted ? incoming : existing
}

export class ClientsStore {
  constructor(file) {
    this.file = file
    this.data = { agencies: {} }
    this.loaded = false
    this.writing = null
    this.dirty = false
  }

  async load() {
    if (this.loaded) return
    try {
      const text = await readFile(this.file, 'utf8')
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed.agencies === 'object') this.data = parsed
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('[clients] could not read store, starting empty:', err.message)
    }
    this.loaded = true
  }

  agency(numagencia) {
    const key = String(numagencia)
    return (this.data.agencies[key] ||= {})
  }

  list(numagencia, since = 0) {
    return Object.values(this.agency(numagencia)).filter((c) => c.updatedAt > since)
  }

  /**
   * Apply a batch of client changes. Returns { accepted: ids applied or already up to date }.
   */
  apply(numagencia, changes, now = Date.now()) {
    const records = this.agency(numagencia)
    const accepted = []
    for (const raw of changes || []) {
      const incoming = sanitizeClient(raw, now)
      if (!incoming) continue
      const winner = mergeClient(records[incoming.id], incoming)
      if (winner !== records[incoming.id]) {
        records[incoming.id] = winner
        this.dirty = true
      }
      accepted.push(incoming.id)
    }
    return { accepted }
  }

  /** Drop tombstones older than `maxAgeMs` to keep the file small. */
  compact(maxAgeMs = 1000 * 60 * 60 * 24 * 90, now = Date.now()) {
    for (const records of Object.values(this.data.agencies)) {
      for (const [id, c] of Object.entries(records)) {
        if (c.deleted && now - c.updatedAt > maxAgeMs) {
          delete records[id]
          this.dirty = true
        }
      }
    }
  }

  async save() {
    if (!this.dirty) return
    if (this.writing) return this.writing
    this.writing = (async () => {
      this.dirty = false
      await mkdir(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      await writeFile(tmp, JSON.stringify(this.data), 'utf8')
      await rename(tmp, this.file)
    })().finally(() => {
      this.writing = null
    })
    return this.writing
  }
}
