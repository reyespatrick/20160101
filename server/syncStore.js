/**
 * Generic per-agency record store persisted to a JSON file.
 *
 * Records are merged with last-write-wins on `updatedAt`. Deletions are kept as
 * tombstones ({ deleted: true }) so offline devices learn about them on sync.
 * A `sanitize(raw, now)` function normalises incoming records (returns null to reject).
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** Pure merge rule mirrored by the client. Returns the winner. */
export function mergeRecord(existing, incoming) {
  if (!existing) return incoming
  if (!incoming) return existing
  if (incoming.updatedAt > existing.updatedAt) return incoming
  if (incoming.updatedAt < existing.updatedAt) return existing
  // Same timestamp: a deletion wins, otherwise keep the existing record
  return incoming.deleted && !existing.deleted ? incoming : existing
}

export class SyncStore {
  constructor(file, sanitize) {
    this.file = file
    this.sanitize = sanitize
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
      if (err.code !== 'ENOENT') console.error(`[store] could not read ${this.file}, starting empty:`, err.message)
    }
    this.loaded = true
  }

  agency(numagencia) {
    const key = String(numagencia)
    return (this.data.agencies[key] ||= {})
  }

  get(numagencia, id) {
    return this.agency(numagencia)[id] || null
  }

  /** Records changed (by a device or by the server, e.g. forwarding state) after `since`. */
  list(numagencia, since = 0) {
    return Object.values(this.agency(numagencia)).filter((r) => (r.serverUpdatedAt || r.updatedAt) > since)
  }

  /**
   * Set a server-owned field (e.g. `remote`) without touching the device-owned
   * `updatedAt`; bumps `serverUpdatedAt` so devices pick the change up.
   */
  setServerField(numagencia, id, field, value, now = Date.now()) {
    const records = this.agency(numagencia)
    if (!records[id]) return
    records[id] = { ...records[id], [field]: value, serverUpdatedAt: now }
    this.dirty = true
  }

  /** Apply a batch of changes. Returns { accepted: ids applied or already up to date, changed: ids whose stored copy changed }. */
  apply(numagencia, changes, now = Date.now()) {
    const records = this.agency(numagencia)
    const accepted = []
    const changed = []
    for (const raw of changes || []) {
      const incoming = this.sanitize(raw, now)
      if (!incoming) continue
      const existing = records[incoming.id]
      const winner = mergeRecord(existing, incoming)
      if (winner !== existing) {
        // `remote` (Inmovilla forwarding state) is server-owned: devices never overwrite it.
        records[incoming.id] = { ...winner, remote: existing?.remote, serverUpdatedAt: now }
        if (records[incoming.id].remote === undefined) delete records[incoming.id].remote
        this.dirty = true
        changed.push(incoming.id)
      }
      accepted.push(incoming.id)
    }
    return { accepted, changed }
  }

  /** Drop tombstones older than `maxAgeMs` to keep the file small. Returns removed [agency, id] pairs. */
  compact(maxAgeMs = 1000 * 60 * 60 * 24 * 90, now = Date.now()) {
    const removed = []
    for (const [agency, records] of Object.entries(this.data.agencies)) {
      for (const [id, r] of Object.entries(records)) {
        if (r.deleted && now - r.updatedAt > maxAgeMs) {
          delete records[id]
          this.dirty = true
          removed.push([agency, id])
        }
      }
    }
    return removed
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

// Shared field helpers for sanitizers
export const MAX_LIST = 50
export function str(v, max = 300) {
  return typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max)
}
export function num(v) {
  const n = Number(v)
  return Number.isFinite(n) && v !== '' && v !== null ? n : null
}
export function list(v, max = 120) {
  return Array.isArray(v) ? v.slice(0, MAX_LIST).map((x) => str(x, max)).filter(Boolean) : []
}
export function validId(id) {
  return /^[A-Za-z0-9_-]{6,64}$/.test(id)
}
export function clampUpdatedAt(raw, now) {
  const updatedAt = num(raw.updatedAt) ?? now
  return Math.min(updatedAt, now + 5 * 60_000) // ignore clocks far in the future
}
