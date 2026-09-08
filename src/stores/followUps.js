import { defineStore } from 'pinia'
import { callInmovilla, splitSection } from '../api/inmovilla'
import { fromInmovillaFollowUp } from '../api/inmovillaMapping'
import { isAuthError, isRateLimited, saveFollowUp, searchFollowUps } from '../api/inmovillaRest'
import { followUpsDb } from '../db/followUpsDb'
import { bucketOf, emptyFollowUp, matchesFollowUp } from '../models/followUp'
import { pendingRecords, upsertRemote } from '../sync/outbox'
import { useAuthStore } from './auth'
import { useClientsStore } from './clients'
import { useEnumsStore } from './enums'

/**
 * Follow-ups ("seguimientos") live in Inmovilla. The device keeps a cache + outbox:
 *   - create / update → POST /seguimientos/ (with codseg to update; Inmovilla has no delete)
 *   - pull → /seguimientos/search/ by creation date (last PULL_DAYS days), at most every PULL_EVERY_MS
 * Limit: 20 calls/min; a 408 pauses the outbox for a minute.
 */
const RETRY_AFTER_408_MS = 65_000
const PULL_DAYS = 120
const PULL_EVERY_MS = 5 * 60_000

export const useFollowUpsStore = defineStore('followUps', {
  state: () => ({
    items: [],
    loaded: false,
    loading: false,
    syncing: false,
    pulling: false,
    lastSyncAt: 0,
    lastPullAt: 0,
    syncError: '',
    needsLogin: false,
    rateLimitedUntil: 0,
    query: '',
    showClosed: false,
  }),
  getters: {
    active: (s) => s.items.filter((f) => !f.deleted),
    pendingCount: (s) => s.items.filter((f) => f.dirty).length,
    openCount() {
      return this.active.filter((f) => !f.closed).length
    },
    dueCount() {
      const now = Date.now()
      return this.active.filter((f) => !f.closed && ['overdue', 'today'].includes(bucketOf(f, now))).length
    },
    filtered(s) {
      return this.active
        .filter((f) => (s.showClosed || !f.closed) && matchesFollowUp(f, s.query))
        .sort((a, b) => (a.closed === b.closed ? a.remindAt - b.remindAt : a.closed ? 1 : -1))
    },
    grouped() {
      const now = Date.now()
      const groups = { overdue: [], today: [], upcoming: [], closed: [] }
      for (const f of this.filtered) groups[bucketOf(f, now)].push(f)
      groups.closed.sort((a, b) => (b.doneAt || b.remindAt) - (a.doneAt || a.remindAt))
      return groups
    },
    byId: (s) => (id) => s.items.find((f) => f.id === String(id) && !f.deleted) || null,
    forProperty: (s) => (codOfer) => s.items.filter((f) => !f.deleted && String(f.propertyCodOfer) === String(codOfer)).sort((a, b) => b.remindAt - a.remindAt),
    forClient: (s) => (remoteId) => s.items.filter((f) => !f.deleted && String(f.clientRemoteId) === String(remoteId)).sort((a, b) => b.remindAt - a.remindAt),
  },
  actions: {
    agency() {
      return useAuthStore().numagencia
    },
    async load() {
      const agency = this.agency()
      if (!agency) return
      this.loading = true
      try {
        this.items = await followUpsDb.all(agency)
        this.lastSyncAt = (await followUpsDb.getMeta(`lastSync:${agency}`)) || 0
        this.lastPullAt = (await followUpsDb.getMeta(`lastPull:${agency}`)) || 0
        this.loaded = true
      } catch (err) {
        this.syncError = err.message || 'No se pudo abrir la base de datos local'
      } finally {
        this.loading = false
      }
    },
    async ensureLoaded() {
      if (!this.loaded) await this.load()
    },
    async get(id) {
      await this.ensureLoaded()
      return this.byId(id)
    },

    async save(followUp) {
      const enums = useEnumsStore()
      const record = { ...emptyFollowUp(), ...followUp, id: followUp.id, updatedAt: Date.now(), deleted: false, syncError: '' }
      if (!record.typeName) record.typeName = enums.followUpTypeLabel(record.typeKey)
      if (record.closed && !record.doneAt) record.doneAt = Date.now()
      if (!record.closed) record.doneAt = null
      const saved = await followUpsDb.putLocal(this.agency(), record)
      this.upsertLocal(saved)
      this.sync()
      return saved
    },
    async setClosed(id, closed) {
      const f = this.byId(id)
      if (f) await this.save({ ...f, closed, doneAt: closed ? Date.now() : null })
    },
    /** Drafts never sent can be discarded; Inmovilla has no delete for sent ones. */
    async discard(id) {
      const f = this.items.find((x) => x.id === id)
      if (!f || f.remoteId) return false
      await followUpsDb.remove(this.agency(), id)
      this.items = this.items.filter((x) => x.id !== id)
      return true
    },
    upsertLocal(f) {
      const i = this.items.findIndex((x) => x.id === f.id)
      if (i >= 0) this.items.splice(i, 1, f)
      else this.items.push(f)
    },

    noteError(err) {
      if (isAuthError(err)) this.needsLogin = true
      else if (isRateLimited(err)) this.rateLimitedUntil = Date.now() + RETRY_AFTER_408_MS
      else if (err.status !== 0) this.syncError = err.message || 'Error al hablar con Inmovilla'
    },

    /** Push the outbox, then pull recent follow-ups from Inmovilla (throttled). */
    async sync({ pull = true } = {}) {
      const auth = useAuthStore()
      const agency = auth.numagencia
      if (!agency || !auth.hasRest || !auth.canWrite || this.syncing) return false
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
      if (this.rateLimitedUntil > Date.now()) {
        setTimeout(() => this.sync(), this.rateLimitedUntil - Date.now() + 500)
        return false
      }
      this.syncing = true
      this.syncError = ''
      try {
        await this.ensureLoaded()
        for (const record of pendingRecords(this.items)) {
          try {
            const { dirty, syncError, ...payload } = record
            const remoteId = await saveFollowUp(payload)
            await followUpsDb.markSynced(agency, record.id, { remoteId: remoteId || record.remoteId || null })
          } catch (err) {
            if (err.status === 0) return false
            if (isAuthError(err)) {
              this.needsLogin = true
              return false
            }
            if (isRateLimited(err)) {
              this.rateLimitedUntil = Date.now() + RETRY_AFTER_408_MS
              setTimeout(() => this.sync(), RETRY_AFTER_408_MS + 500)
              return false
            }
            const failed = { ...record, syncError: err.message || 'Inmovilla rechazó el seguimiento' }
            await followUpsDb.putLocal(agency, failed)
          }
        }
        this.items = await followUpsDb.all(agency)
        this.lastSyncAt = Date.now()
        await followUpsDb.setMeta(`lastSync:${agency}`, this.lastSyncAt)
        this.needsLogin = false
        if (pull) await this.pull()
        return true
      } finally {
        this.syncing = false
      }
    },

    /** Fetch follow-ups created in the last PULL_DAYS days; local unsent edits win. */
    async pull({ force = false } = {}) {
      const auth = useAuthStore()
      const agency = auth.numagencia
      if (!agency || !auth.hasRest || navigator.onLine === false || this.pulling) return
      if (!force && Date.now() - this.lastPullAt < PULL_EVERY_MS) return
      this.pulling = true
      try {
        const enums = useEnumsStore()
        enums.ensureTiposSeguimiento() // not awaited: the enum queue is throttled (2 calls/min); labels resolve when it lands
        const raw = await searchFollowUps({ from: Date.now() - PULL_DAYS * 86_400_000, to: Date.now() })
        const remote = raw.map((r) => fromInmovillaFollowUp(r, (k) => enums.followUpTypeLabel(k))).filter(Boolean)
        // keep labels we already resolved
        const known = new Map(this.items.filter((f) => f.remoteId).map((f) => [f.remoteId, f]))
        for (const r of remote) {
          const k = known.get(r.remoteId)
          if (k) {
            r.propertyLabel = k.propertyLabel
            r.clientLabel = k.clientLabel
            r.id = k.id
          }
        }
        this.items = upsertRemote(this.items, remote)
        await followUpsDb.putClean(agency, this.items.filter((f) => !f.dirty && remote.some((r) => r.remoteId === f.remoteId)))
        this.lastPullAt = Date.now()
        await followUpsDb.setMeta(`lastPull:${agency}`, this.lastPullAt)
        this.resolveLabels()
      } catch (err) {
        this.noteError(err)
      } finally {
        this.pulling = false
      }
    },

    /** Fill property labels through apiweb (unlimited) and client labels from the local cache. */
    async resolveLabels() {
      const auth = useAuthStore()
      const clients = useClientsStore()
      await clients.ensureLoaded()
      const agency = this.agency()
      for (const f of this.items) {
        const patch = {}
        if (f.clientRemoteId && !f.clientLabel) {
          const c = clients.items.find((x) => String(x.remoteId) === String(f.clientRemoteId))
          if (c) patch.clientLabel = [c.name, c.surname].filter(Boolean).join(' ')
        }
        if (f.propertyCodOfer && !f.propertyLabel && navigator.onLine !== false) {
          try {
            const data = await callInmovilla([{ type: 'paginacion', pos: 1, num: 1, where: `cod_ofer=${Number(f.propertyCodOfer)}`, order: '' }])
            const p = splitSection(data.paginacion).items[0]
            if (p) patch.propertyLabel = `Ref. ${p.ref} · ${[p.nbtipo, p.ciudad].filter(Boolean).join(' en ')}`
          } catch {
            /* try again next time */
          }
        }
        if (Object.keys(patch).length) {
          await followUpsDb.patch(agency, f.id, patch)
          this.upsertLocal({ ...f, ...patch })
        }
      }
    },

    reset() {
      this.$reset()
    },
  },
})
