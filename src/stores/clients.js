import { defineStore } from 'pinia'
import { createClient, deleteClient, getClient, isAuthError, isRateLimited, searchClients, updateClient } from '../api/inmovillaRest'
import { clientsDb } from '../db/clientsDb'
import { digitsOf, emptyClient, looksLikeEmail, looksLikePhone, matchesClient } from '../models/client'
import { pendingRecords, planFor, upsertRemote } from '../sync/outbox'
import { useAuthStore } from './auth'

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
      if (!auth.restToken || navigator.onLine === false || !(looksLikePhone(q) || looksLikeEmail(q))) return []
      this.searching = true
      try {
        await this.ensureLoaded()
        const params = looksLikeEmail(q) ? { email: q } : { telefono: digitsOf(q).slice(-9) }
        const found = await searchClients(auth.restToken, params)
        if (found.length) {
          this.items = upsertRemote(this.items, found)
          await clientsDb.putClean(this.agency(), this.items.filter((c) => found.some((f) => f.remoteId === c.remoteId) && !c.dirty))
        }
        this.remoteResultsFor = q
        return found
      } catch (err) {
        this.noteError(err)
        return []
      } finally {
        this.searching = false
      }
    },

    /** Re-read one client from Inmovilla (used when opening its sheet). */
    async refresh(id) {
      const auth = useAuthStore()
      const local = this.byId(id)
      if (!local?.remoteId || local.dirty || !auth.restToken || navigator.onLine === false) return
      try {
        const fresh = await getClient(auth.restToken, local.remoteId)
        if (fresh) {
          const merged = { ...fresh, id: local.id, dirty: false }
          await clientsDb.putClean(this.agency(), [merged])
          this.upsertLocal(merged)
        }
      } catch (err) {
        if (err.status === 404) {
          await clientsDb.remove(this.agency(), id)
          this.items = this.items.filter((c) => c.id !== id)
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
      if (!agency || !auth.restToken || this.syncing) return false
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
            await this.pushOne(auth.restToken, agency, record)
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

    async pushOne(token, agency, record) {
      const { dirty, syncError, ...payload } = record
      switch (planFor(record)) {
        case 'create': {
          const remoteId = await createClient(token, payload)
          await clientsDb.markSynced(agency, record.id, { remoteId: remoteId || null })
          break
        }
        case 'update':
          await updateClient(token, payload)
          await clientsDb.markSynced(agency, record.id, {})
          break
        case 'delete':
          await deleteClient(token, record.remoteId)
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
