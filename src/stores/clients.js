import { defineStore } from 'pinia'
import { createClient, deleteClient, getClient, isAuthError, isRateLimited, searchClients, updateClient } from '../api/inmovillaRest'
import { clientsDb } from '../db/clientsDb'
import { digitsOf, emptyClient, looksLikeEmail, looksLikePhone, matchesClient } from '../models/client'
import { pendingRecords, planFor, upsertRemote } from '../sync/outbox'
import { useAuthStore } from './auth'
import { isNetworkError } from '../composables/useOnlineRetry'

/**
 * Clients live in Inmovilla. Inmovilla has no "list all clients" call, only a search by
 * phone or email, so this store keeps a device cache of the clients created or looked up
 * here (searchable offline by anything) plus an outbox replayed against the REST API.
 */
const RETRY_AFTER_408_MS = 65_000

export const useClientsStore = defineStore('clients', {
  state: () => ({
    items: [],
    loaded: false,
    loading: false,
    syncing: false,
    searching: false,
    searchOffline: false, // the last remote search never left the device
    lastSyncAt: 0,
    syncError: '',
    needsLogin: false,
    rateLimitedUntil: 0,
    query: '',
    remoteResultsFor: '',
  }),
  getters: {
    active: (s) => s.items.filter((c) => !c.deleted),
    pendingCount: (s) => s.items.filter((c) => c.dirty).length,
    filtered(s) {
      return this.active.filter((c) => matchesClient(c, s.query)).sort((a, b) => b.updatedAt - a.updatedAt)
    },
    byId: (s) => (id) => s.items.find((c) => c.id === String(id) && !c.deleted) || null,
    canSearchRemote: (s) => looksLikePhone(s.query) || looksLikeEmail(s.query),
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
        this.items = await clientsDb.all(agency)
        this.lastSyncAt = (await clientsDb.getMeta(`lastSync:${agency}`)) || 0
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

    async save(client) {
      const record = { ...emptyClient(), ...client, id: client.id, updatedAt: Date.now(), deleted: false, syncError: '' }
      if (!record.createdAt) record.createdAt = record.updatedAt
      const saved = await clientsDb.putLocal(this.agency(), record)
      this.upsertLocal(saved)
      this.sync()
      return saved
    },
    /**
     * Record something the app learned on its own — the answer to a lookup, a date of check —
     * without turning it into a change worth sending.
     */
    async note(id, patch) {
      const updated = await clientsDb.note(this.agency(), id, patch)
      if (updated) this.upsertLocal(updated)
      return updated
    },

    async remove(id) {
      const existing = this.items.find((c) => c.id === id)
      if (!existing) return
      if (!existing.remoteId) {
        await clientsDb.remove(this.agency(), id)
        this.items = this.items.filter((c) => c.id !== id)
        return
      }
      const saved = await clientsDb.putLocal(this.agency(), { ...existing, deleted: true, updatedAt: Date.now() })
      this.upsertLocal(saved)
      this.sync()
    },
    upsertLocal(client) {
      const i = this.items.findIndex((c) => c.id === client.id)
      if (i >= 0) this.items.splice(i, 1, client)
      else this.items.push(client)
    },

    /** Look a client up in Inmovilla by phone or email and add the results to the cache. */
    async searchRemote(query = this.query) {
      const auth = useAuthStore()
      const q = String(query || '').trim()
      if (!auth.hasRest || !(looksLikePhone(q) || looksLikeEmail(q))) return []
      if (navigator.onLine === false) {
        this.searchOffline = true
        return []
      }
      this.searching = true
      this.searchOffline = false
      try {
        await this.ensureLoaded()
        const params = looksLikeEmail(q) ? { email: q } : { telefono: digitsOf(q).slice(-9) }
        const found = await searchClients(params)
        if (found.length) {
          this.items = upsertRemote(this.items, found)
          await clientsDb.putClean(this.agency(), this.items.filter((c) => found.some((f) => f.remoteId === c.remoteId) && !c.dirty))
        }
        this.remoteResultsFor = q
        return found
      } catch (err) {
        if (isNetworkError(err)) this.searchOffline = true
        else this.noteError(err)
        return []
      } finally {
        this.searching = false
      }
    },

    /** Re-read one client from Inmovilla (used when opening its sheet). */
    async refresh(id) {
      const auth = useAuthStore()
      const local = this.byId(id)
      if (!local?.remoteId || local.dirty || !auth.hasRest || navigator.onLine === false) return
      // A contact created a moment ago is not worth re-reading: nothing can have changed since,
      // and a CRM that has not finished making it readable would answer 404 for a record that
      // very much exists. Opening a client you just created must not look like losing it.
      if (local.sentAt && Date.now() - local.sentAt < 60_000) return
      try {
        const fresh = await getClient(local.remoteId)
        if (fresh) {
          const merged = { ...fresh, id: local.id, dirty: false }
          await clientsDb.putClean(this.agency(), [merged])
          this.upsertLocal(merged)
        }
      } catch (err) {
        if (err.status === 404) {
          // Inmovilla no longer has it — which is not the same as "it never existed", and is
          // certainly not permission to throw away what the agent holds. A 404 can mean deleted
          // at the office, or an upstream having a bad minute. The record stays, flagged, and
          // whoever wants it gone can delete it themselves.
          await clientsDb.note(this.agency(), id, { remoteMissing: true })
          this.upsertLocal({ ...local, remoteMissing: true })
        } else this.noteError(err)
      }
    },

    noteError(err) {
      if (isAuthError(err)) this.needsLogin = true
      else if (isRateLimited(err)) this.rateLimitedUntil = Date.now() + RETRY_AFTER_408_MS
      else if (err.status !== 0) this.syncError = err.message || 'Error al hablar con Inmovilla'
    },

    /** Replay the outbox against Inmovilla. */
    async sync() {
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
            await this.pushOne(agency, record)
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
            const failed = { ...record, syncError: err.message || 'Inmovilla rechazó el cambio' }
            await clientsDb.putLocal(agency, failed)
            this.upsertLocal({ ...failed, dirty: true })
          }
        }
        this.lastSyncAt = Date.now()
        await clientsDb.setMeta(`lastSync:${agency}`, this.lastSyncAt)
        this.needsLogin = false
        return true
      } finally {
        this.syncing = false
      }
    },

    async pushOne(agency, record) {
      const { dirty, syncError, ...payload } = record
      switch (planFor(record)) {
        case 'create': {
          const remoteId = await createClient(payload)
          await clientsDb.markSynced(agency, record.id, { remoteId: remoteId || null, sentAt: Date.now() })
          break
        }
        case 'update':
          await updateClient(payload)
          await clientsDb.markSynced(agency, record.id, { sentAt: Date.now() })
          break
        case 'delete':
          await deleteClient(record.remoteId)
          await clientsDb.remove(agency, record.id)
          break
        default:
          await clientsDb.remove(agency, record.id)
      }
      this.items = await clientsDb.all(agency)
    },

    reset() {
      this.$reset()
    },
  },
})
