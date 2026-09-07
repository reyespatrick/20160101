/**
 * Pushes records from a SyncStore to Inmovilla and records the outcome on each
 * record under the server-owned `remote` field:
 *
 *   remote: { id, state: 'pending' | 'synced' | 'error', syncedAt, syncedVersion, error, attempts }
 *
 * The store stays the offline outbox/cache; Inmovilla is the system of record.
 * Failed pushes are retried on the next sync and by the periodic timer.
 */

export class Forwarder {
  constructor({ store, rest, kind, log = console, photoLoader = null, maxAttemptsBeforeBackoff = 5 }) {
    this.store = store
    this.rest = rest
    this.kind = kind // 'property' | 'client'
    this.log = log
    this.photoLoader = photoLoader // async (agency, propertyId, photoId) => Buffer|null
    this.maxAttemptsBeforeBackoff = maxAttemptsBeforeBackoff
    this.running = new Set()
  }

  needsPush(record) {
    const r = record.remote
    if (!r) return !record.deleted || false
    if (record.deleted) return Boolean(r.id) && r.state !== 'deleted'
    return r.state !== 'synced' || r.syncedVersion !== record.updatedAt
  }

  pending(agency) {
    return this.store.list(agency).filter((rec) => this.needsPush(rec))
  }

  /** Push everything pending for one agency. Serialised per agency; concurrent calls return early. */
  async run(agency) {
    if (!this.rest?.enabled || this.running.has(agency)) return { pushed: 0, failed: 0 }
    this.running.add(agency)
    let pushed = 0
    let failed = 0
    try {
      for (const record of this.pending(agency)) {
        const attempts = record.remote?.attempts || 0
        if (attempts >= this.maxAttemptsBeforeBackoff && Date.now() - (record.remote?.lastAttemptAt || 0) < 15 * 60_000) continue
        try {
          await this.pushOne(agency, record)
          pushed++
        } catch (err) {
          failed++
          this.setRemote(agency, record.id, {
            ...(record.remote || {}),
            state: 'error',
            error: String(err.message || err).slice(0, 300),
            attempts: attempts + 1,
            lastAttemptAt: Date.now(),
          })
          this.log.warn(`[forwarder:${this.kind}] ${record.id}: ${err.message}`)
        }
      }
      await this.store.save()
    } finally {
      this.running.delete(agency)
    }
    return { pushed, failed }
  }

  async pushOne(agency, record) {
    const remoteId = record.remote?.id || null
    if (record.deleted) {
      if (remoteId) await (this.kind === 'property' ? this.rest.deleteProperty(remoteId) : this.rest.deleteClient(remoteId))
      this.setRemote(agency, record.id, { ...(record.remote || {}), state: 'deleted', syncedAt: Date.now(), syncedVersion: record.updatedAt, error: '' })
      return
    }
    let id = remoteId
    if (this.kind === 'property') {
      id = remoteId ? await this.rest.updateProperty(remoteId, record) : await this.rest.createProperty(record)
    } else {
      id = remoteId ? await this.rest.updateClient(remoteId, record) : await this.rest.createClient(record)
    }
    const remote = {
      ...(record.remote || {}),
      id: id || remoteId || null,
      state: 'synced',
      syncedAt: Date.now(),
      syncedVersion: record.updatedAt,
      error: '',
      attempts: 0,
    }
    if (this.kind === 'property') remote.photos = await this.pushPhotos(agency, record, remote)
    this.setRemote(agency, record.id, remote)
  }

  /** Upload photos that Inmovilla does not have yet. Returns the map photoId -> remote photo id. */
  async pushPhotos(agency, record, remote) {
    const done = { ...(remote.photos || {}) }
    if (!this.photoLoader || !remote.id) return done
    for (const ph of record.photos || []) {
      if (done[ph.id]) continue
      const buffer = await this.photoLoader(agency, record.id, ph.id)
      if (!buffer) continue // not uploaded to our server yet; next run
      const photoRemoteId = await this.rest.uploadPhoto(remote.id, buffer, { order: ph.order, caption: ph.caption })
      done[ph.id] = photoRemoteId || 'ok'
    }
    return done
  }

  setRemote(agency, id, remote) {
    this.store.setServerField(agency, id, 'remote', remote)
  }
}

export function startPeriodicForwarding(forwarders, intervalMs = 5 * 60_000) {
  const tick = async () => {
    for (const f of forwarders) {
      for (const agency of Object.keys(f.store.data.agencies)) {
        try {
          await f.run(agency)
        } catch (err) {
          f.log.error(`[forwarder:${f.kind}] periodic run failed:`, err.message)
        }
      }
    }
  }
  const timer = setInterval(tick, intervalMs)
  timer.unref?.()
  return timer
}
